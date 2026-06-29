/* ==========================================================
   BHUZ - SERVICES ROUTES
   Archivo: routes/services.routes.js

   Objetivo:
   - Backend real y escalable para servicios BHUZ.
   - Primer servicio: Enviar paquetes.
   - Preparado para futuros servicios: farmacia, market, compras, documentos.
   - No toca comida, restaurantes ni pedidos existentes.
========================================================== */

const express = require("express");

const {
  generarIdServicio,
  generarTokenServicio,
  generarCodigoEntrega,
  limpiarTexto,
  normalizarEmail,
  numero,
  calcularDistanciaKm,
  calcularMontoEnvio,
  normalizarEstadoServicio,
  mapearServicio,
  mapearTokenServicio,
  buildFrontendBaseUrl,
  buildReceiverConfirmUrl
} = require("../utils/services.helpers");

function crearRutasServices({ pool }) {
  const router = express.Router();

  async function insertarHistorial(client, { serviceId, previousStatus, newStatus, changedBy, notes }) {
    await client.query(
      `
      INSERT INTO bhuz_service_status_history (
        id, service_id, previous_status, new_status, changed_by, notes, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      `,
      [
        generarIdServicio("history"),
        serviceId,
        previousStatus || null,
        newStatus,
        changedBy || "system",
        notes || null
      ]
    );
  }

  async function obtenerServicioPorId(serviceId, clientOrPool = pool) {
    const result = await clientOrPool.query(
      `
      SELECT *
      FROM bhuz_services
      WHERE id = $1
      LIMIT 1
      `,
      [String(serviceId || "").trim()]
    );

    return result.rows[0] || null;
  }

  async function obtenerToken(token, clientOrPool = pool) {
    const result = await clientOrPool.query(
      `
      SELECT *
      FROM bhuz_service_tokens
      WHERE token = $1
      LIMIT 1
      `,
      [String(token || "").trim()]
    );

    return result.rows[0] || null;
  }

  /* ======================================================
     POST /api/services
     Crea un servicio real de BHUZ Envíos.
     Estado inicial: PENDING_PAYMENT
  ====================================================== */
  router.post("/", async (req, res) => {
    const body = req.body || {};

    const pickupLatitude = limpiarTexto(body.pickupLatitude || body.retiroLat || body.pickup?.lat);
    const pickupLongitude = limpiarTexto(body.pickupLongitude || body.retiroLng || body.pickup?.lng);
    const deliveryLatitude = limpiarTexto(body.deliveryLatitude || body.entregaLat || body.delivery?.lat);
    const deliveryLongitude = limpiarTexto(body.deliveryLongitude || body.entregaLng || body.delivery?.lng);

    const distanceKmFromBody = numero(body.distanceKm || body.distanciaKm, 0);
    const calculatedDistanceKm = distanceKmFromBody || calcularDistanciaKm(
      pickupLatitude,
      pickupLongitude,
      deliveryLatitude,
      deliveryLongitude
    );

    const totalFromBody = numero(body.totalAmount || body.totalEnvio || body.total, 0);
    const calculatedTotal = totalFromBody || calcularMontoEnvio(calculatedDistanceKm);

    const customerEmail = normalizarEmail(body.customerEmail || body.senderEmail || body.email || "");
    const receiverName = limpiarTexto(body.receiverName || body.contacto || body.recipientName || "");
    const pickupAddress = limpiarTexto(body.pickupAddress || body.origen || "");
    const deliveryAddress = limpiarTexto(body.deliveryAddress || body.destino || "");
    const packageDescription = limpiarTexto(body.packageDescription || body.descripcion || "");
    const packageSize = limpiarTexto(body.packageSize || body.tamano || "");

    if (!pickupAddress) {
      return res.status(400).json({ ok: false, message: "La dirección de retiro es obligatoria" });
    }

    if (!deliveryAddress) {
      return res.status(400).json({ ok: false, message: "La dirección de entrega es obligatoria" });
    }

    if (!receiverName) {
      return res.status(400).json({ ok: false, message: "El contacto del receptor es obligatorio" });
    }

    if (!packageDescription) {
      return res.status(400).json({ ok: false, message: "La descripción del paquete es obligatoria" });
    }

    if (!packageSize) {
      return res.status(400).json({ ok: false, message: "El tamaño del paquete es obligatorio" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const serviceId = generarIdServicio("service");
      const deliveryCode = generarCodigoEntrega();

      const result = await client.query(
        `
        INSERT INTO bhuz_services (
          id, service_type,
          customer_email, customer_name, customer_phone,
          receiver_name, receiver_phone,
          pickup_address, pickup_reference, pickup_latitude, pickup_longitude,
          delivery_address, delivery_reference, delivery_latitude, delivery_longitude,
          package_description, package_size, package_photo_url,
          distance_km, total_amount, payment_status, payment_method,
          status, delivery_code, delivery_code_used,
          created_at, updated_at
        )
        VALUES (
          $1,$2,
          $3,$4,$5,
          $6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,
          $16,$17,$18,
          $19,$20,$21,$22,
          $23,$24,FALSE,
          NOW(),NOW()
        )
        RETURNING *
        `,
        [
          serviceId,
          limpiarTexto(body.serviceType || "PACKAGE").toUpperCase(),

          customerEmail || null,
          limpiarTexto(body.customerName || body.senderName || ""),
          limpiarTexto(body.customerPhone || body.senderPhone || ""),

          receiverName,
          limpiarTexto(body.receiverPhone || body.recipientPhone || ""),

          pickupAddress,
          limpiarTexto(body.pickupReference || body.referenciaRetiro || ""),
          pickupLatitude,
          pickupLongitude,

          deliveryAddress,
          limpiarTexto(body.deliveryReference || body.referenciaEntrega || ""),
          deliveryLatitude,
          deliveryLongitude,

          packageDescription,
          packageSize,
          limpiarTexto(body.packagePhotoUrl || body.fotoUrl || ""),

          calculatedDistanceKm,
          calculatedTotal,
          limpiarTexto(body.paymentStatus || "PENDING").toUpperCase(),
          limpiarTexto(body.paymentMethod || ""),

          normalizarEstadoServicio(body.status || "PENDING_PAYMENT"),
          deliveryCode
        ]
      );

      await insertarHistorial(client, {
        serviceId,
        previousStatus: null,
        newStatus: "PENDING_PAYMENT",
        changedBy: customerEmail || "customer",
        notes: "Servicio creado desde módulo BHUZ Envíos"
      });

      await client.query("COMMIT");

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Servicio creado correctamente",
        service: mapearServicio(result.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error creando servicio BHUZ:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error creando servicio",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  /* ======================================================
     GET /api/services/:id
     Consulta un servicio.
  ====================================================== */
  router.get("/:id", async (req, res) => {
    const serviceId = String(req.params.id || "").trim();

    if (!serviceId) {
      return res.status(400).json({ ok: false, message: "ID de servicio inválido" });
    }

    try {
      const service = await obtenerServicioPorId(serviceId);

      if (!service) {
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      const historyResult = await pool.query(
        `
        SELECT *
        FROM bhuz_service_status_history
        WHERE service_id = $1
        ORDER BY created_at ASC
        `,
        [serviceId]
      );

      return res.json({
        ok: true,
        source: "postgres",
        service: mapearServicio(service),
        history: historyResult.rows
      });
    } catch (error) {
      console.error("Error consultando servicio:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error consultando servicio",
        error: error.message
      });
    }
  });

  /* ======================================================
     POST /api/services/:id/receiver-token
     Genera o reutiliza link para que el receptor confirme GPS.
  ====================================================== */
  router.post("/:id/receiver-token", async (req, res) => {
    const serviceId = String(req.params.id || "").trim();

    if (!serviceId) {
      return res.status(400).json({ ok: false, message: "ID de servicio inválido" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const service = await obtenerServicioPorId(serviceId, client);

      if (!service) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      const existingResult = await client.query(
        `
        SELECT *
        FROM bhuz_service_tokens
        WHERE service_id = $1
          AND token_type = 'RECEIVER_LOCATION'
          AND receiver_confirmed = FALSE
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [serviceId]
      );

      let tokenRow = existingResult.rows[0];

      if (!tokenRow) {
        const token = generarTokenServicio();

        const tokenResult = await client.query(
          `
          INSERT INTO bhuz_service_tokens (
            id, service_id, token, token_type,
            receiver_confirmed, expires_at,
            created_at, updated_at
          )
          VALUES ($1,$2,$3,'RECEIVER_LOCATION',FALSE,NOW() + INTERVAL '24 hours',NOW(),NOW())
          RETURNING *
          `,
          [
            generarIdServicio("token"),
            serviceId,
            token
          ]
        );

        tokenRow = tokenResult.rows[0];
      }

      const baseUrl = buildFrontendBaseUrl(req.body?.frontendBaseUrl, req);
      const shareUrl = buildReceiverConfirmUrl(baseUrl, tokenRow.token);

      await insertarHistorial(client, {
        serviceId,
        previousStatus: service.status,
        newStatus: "WAITING_RECEIVER_LOCATION",
        changedBy: "customer",
        notes: "Link de receptor generado"
      });

      await client.query(
        `
        UPDATE bhuz_services
        SET status = 'WAITING_RECEIVER_LOCATION', updated_at = NOW()
        WHERE id = $1
        `,
        [serviceId]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Link de receptor generado correctamente",
        token: mapearTokenServicio(tokenRow),
        shareUrl
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error generando token receptor:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error generando link del receptor",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  /* ======================================================
     GET /api/services/confirmar/:token
     Consulta pública del receptor.
  ====================================================== */
  router.get("/confirmar/:token", async (req, res) => {
    const token = String(req.params.token || "").trim();

    if (!token) {
      return res.status(400).json({ ok: false, message: "Token inválido" });
    }

    try {
      const tokenRow = await obtenerToken(token);

      if (!tokenRow) {
        return res.status(404).json({ ok: false, message: "Link no encontrado" });
      }

      const service = await obtenerServicioPorId(tokenRow.service_id);

      if (!service) {
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      return res.json({
        ok: true,
        source: "postgres",
        token: mapearTokenServicio(tokenRow),
        service: mapearServicio(service)
      });
    } catch (error) {
      console.error("Error consultando token receptor:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error consultando link del receptor",
        error: error.message
      });
    }
  });

  /* ======================================================
     POST /api/services/confirmar/:token
     Receptor confirma GPS. No cambia estados manualmente.
  ====================================================== */
  router.post("/confirmar/:token", async (req, res) => {
    const token = String(req.params.token || "").trim();
    const latitude = limpiarTexto(req.body?.latitude || req.body?.lat);
    const longitude = limpiarTexto(req.body?.longitude || req.body?.lng);

    if (!token) {
      return res.status(400).json({ ok: false, message: "Token inválido" });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({ ok: false, message: "Latitud y longitud son obligatorias" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const tokenRow = await obtenerToken(token, client);

      if (!tokenRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Link no encontrado" });
      }

      const service = await obtenerServicioPorId(tokenRow.service_id, client);

      if (!service) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      const tokenResult = await client.query(
        `
        UPDATE bhuz_service_tokens
        SET
          receiver_latitude = $1,
          receiver_longitude = $2,
          receiver_confirmed = TRUE,
          confirmed_at = NOW(),
          updated_at = NOW()
        WHERE token = $3
        RETURNING *
        `,
        [latitude, longitude, token]
      );

      const distanceKm = calcularDistanciaKm(
        service.pickup_latitude,
        service.pickup_longitude,
        latitude,
        longitude
      ) || numero(service.distance_km, 0);

      const totalAmount = distanceKm ? calcularMontoEnvio(distanceKm) : numero(service.total_amount, 0);

      const serviceResult = await client.query(
        `
        UPDATE bhuz_services
        SET
          delivery_latitude = $1,
          delivery_longitude = $2,
          distance_km = $3,
          total_amount = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
        `,
        [
          latitude,
          longitude,
          distanceKm,
          totalAmount,
          service.id
        ]
      );

      await insertarHistorial(client, {
        serviceId: service.id,
        previousStatus: service.status,
        newStatus: service.status,
        changedBy: "receiver",
        notes: "Receptor confirmó ubicación GPS"
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Ubicación del receptor confirmada",
        token: mapearTokenServicio(tokenResult.rows[0]),
        service: mapearServicio(serviceResult.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error confirmando ubicación receptor:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error confirmando ubicación",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  /* ======================================================
     POST /api/services/:id/status
     Actualiza estado desde backend/panel/repartidor.
  ====================================================== */
  router.post("/:id/status", async (req, res) => {
    const serviceId = String(req.params.id || "").trim();
    const newStatus = normalizarEstadoServicio(req.body?.status);
    const changedBy = limpiarTexto(req.body?.changedBy || "system");
    const notes = limpiarTexto(req.body?.notes || "");

    if (!serviceId) {
      return res.status(400).json({ ok: false, message: "ID de servicio inválido" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const service = await obtenerServicioPorId(serviceId, client);

      if (!service) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      const result = await client.query(
        `
        UPDATE bhuz_services
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [newStatus, serviceId]
      );

      await insertarHistorial(client, {
        serviceId,
        previousStatus: service.status,
        newStatus,
        changedBy,
        notes
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Estado actualizado correctamente",
        service: mapearServicio(result.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error actualizando estado:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error actualizando estado",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  /* ======================================================
     POST /api/services/:id/confirm-delivery
     Repartidor confirma entrega usando código único.
  ====================================================== */
  router.post("/:id/confirm-delivery", async (req, res) => {
    const serviceId = String(req.params.id || "").trim();
    const deliveryCode = limpiarTexto(req.body?.deliveryCode || req.body?.code);
    const driverId = limpiarTexto(req.body?.driverId || "");
    const driverName = limpiarTexto(req.body?.driverName || "");

    if (!serviceId) {
      return res.status(400).json({ ok: false, message: "ID de servicio inválido" });
    }

    if (!deliveryCode) {
      return res.status(400).json({ ok: false, message: "Código de entrega obligatorio" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const service = await obtenerServicioPorId(serviceId, client);

      if (!service) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      if (service.delivery_code_used === true) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, message: "Este código ya fue utilizado" });
      }

      if (String(service.delivery_code || "").trim() !== deliveryCode) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, message: "Código de entrega incorrecto" });
      }

      const result = await client.query(
        `
        UPDATE bhuz_services
        SET
          status = 'DELIVERED',
          delivery_code_used = TRUE,
          driver_id = COALESCE(NULLIF($1, ''), driver_id),
          driver_name = COALESCE(NULLIF($2, ''), driver_name),
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
        `,
        [driverId, driverName, serviceId]
      );

      await insertarHistorial(client, {
        serviceId,
        previousStatus: service.status,
        newStatus: "DELIVERED",
        changedBy: driverId || driverName || "driver",
        notes: "Entrega confirmada con código único"
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Entrega confirmada correctamente",
        service: mapearServicio(result.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error confirmando entrega:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error confirmando entrega",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = crearRutasServices;
