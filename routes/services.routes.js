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

  const TRANSICIONES = {
    PENDING_PAYMENT: new Set(["WAITING_RECEIVER_LOCATION", "CANCELLED"]),
    PAID: new Set(["WAITING_RECEIVER_LOCATION", "SEARCHING_DRIVER", "CANCELLED"]),
    WAITING_RECEIVER_LOCATION: new Set(["SEARCHING_DRIVER", "CANCELLED"]),
    SEARCHING_DRIVER: new Set(["DRIVER_ASSIGNED", "CANCELLED"]),
    DRIVER_ASSIGNED: new Set(["GOING_TO_PICKUP", "CANCELLED"]),
    GOING_TO_PICKUP: new Set(["PACKAGE_PICKED", "CANCELLED"]),
    PACKAGE_PICKED: new Set(["GOING_TO_DELIVERY"]),
    GOING_TO_DELIVERY: new Set(["DELIVERED"]),
    DELIVERED: new Set(),
    CANCELLED: new Set()
  };

  function puedeCambiarEstado(actual, siguiente) {
    return actual === siguiente || Boolean(TRANSICIONES[actual]?.has(siguiente));
  }

  function esActorRepartidor(changedBy, service) {
    return Boolean(service.driver_id) && String(changedBy || "") === String(service.driver_id);
  }

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

    // Seguridad: distancia y precio se calculan exclusivamente en backend.
    // Los valores enviados por el navegador nunca se aceptan como definitivos.
    const calculatedDistanceKm = calcularDistanciaKm(
      pickupLatitude,
      pickupLongitude,
      deliveryLatitude,
      deliveryLongitude
    );
    const calculatedTotal = calculatedDistanceKm > 0 ? calcularMontoEnvio(calculatedDistanceKm) : 0;

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

          "PENDING_PAYMENT",
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
     GET /api/services/driver/available
     Lista servicios reales listos para que un repartidor los acepte.
     Fuente real: PostgreSQL.
  ====================================================== */
  router.get("/driver/available", async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM bhuz_services
        WHERE status = 'SEARCHING_DRIVER'
          AND COALESCE(delivery_code_used, FALSE) = FALSE
        ORDER BY created_at ASC
        LIMIT 30
        `
      );

      return res.json({
        ok: true,
        source: "postgres",
        services: result.rows.map(mapearServicio)
      });
    } catch (error) {
      console.error("Error listando servicios disponibles:", error.message);
      return res.status(500).json({
        ok: false,
        message: "Error consultando servicios disponibles",
        error: error.message
      });
    }
  });

  /* ======================================================
     GET /api/services/driver/:driverId/active
     Consulta el servicio activo de un repartidor.
  ====================================================== */
  router.get("/driver/:driverId/active", async (req, res) => {
    const driverId = limpiarTexto(req.params.driverId || "");

    if (!driverId) {
      return res.status(400).json({ ok: false, message: "ID de repartidor inválido" });
    }

    try {
      const result = await pool.query(
        `
        SELECT *
        FROM bhuz_services
        WHERE driver_id = $1
          AND status IN ('DRIVER_ASSIGNED','GOING_TO_PICKUP','PACKAGE_PICKED','GOING_TO_DELIVERY')
          AND COALESCE(delivery_code_used, FALSE) = FALSE
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [driverId]
      );

      return res.json({
        ok: true,
        source: "postgres",
        service: mapearServicio(result.rows[0] || null)
      });
    } catch (error) {
      console.error("Error consultando servicio activo repartidor:", error.message);
      return res.status(500).json({
        ok: false,
        message: "Error consultando servicio activo",
        error: error.message
      });
    }
  });

  /* ======================================================
     GET /api/services/driver/:driverId/history
     Historial simple de entregas del repartidor.
  ====================================================== */
  router.get("/driver/:driverId/history", async (req, res) => {
    const driverId = limpiarTexto(req.params.driverId || "");

    if (!driverId) {
      return res.status(400).json({ ok: false, message: "ID de repartidor inválido" });
    }

    try {
      const result = await pool.query(
        `
        SELECT *
        FROM bhuz_services
        WHERE driver_id = $1
          AND status = 'DELIVERED'
        ORDER BY updated_at DESC
        LIMIT 50
        `,
        [driverId]
      );

      return res.json({
        ok: true,
        source: "postgres",
        services: result.rows.map(mapearServicio)
      });
    } catch (error) {
      console.error("Error consultando historial repartidor:", error.message);
      return res.status(500).json({
        ok: false,
        message: "Error consultando historial del repartidor",
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

      const baseUrl = buildFrontendBaseUrl(null, req);
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

      const pickupLatitude = limpiarTexto(service.pickup_latitude || "");
      const pickupLongitude = limpiarTexto(service.pickup_longitude || "");

      if (!Number(pickupLatitude) || !Number(pickupLongitude)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          message: "El envío no tiene ubicación de retiro válida. Vuelve a crear el link usando el botón de ubicación de retiro."
        });
      }

      const distanceKm = calcularDistanciaKm(
        pickupLatitude,
        pickupLongitude,
        latitude,
        longitude
      );

      const totalAmount = calcularMontoEnvio(distanceKm);

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
     POST /api/services/:id/accept
     Repartidor acepta un servicio disponible.
  ====================================================== */
  router.post("/:id/accept", async (req, res) => {
    const serviceId = String(req.params.id || "").trim();
    const driverId = limpiarTexto(req.body?.driverId || req.body?.id || "");
    const driverName = limpiarTexto(req.body?.driverName || req.body?.name || "Repartidor BHUZ");
    const driverPhone = limpiarTexto(req.body?.driverPhone || req.body?.phone || "");

    if (!serviceId) {
      return res.status(400).json({ ok: false, message: "ID de servicio inválido" });
    }

    if (!driverId) {
      return res.status(400).json({ ok: false, message: "ID de repartidor obligatorio" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const service = await obtenerServicioPorId(serviceId, client);

      if (!service) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Servicio no encontrado" });
      }

      if (service.status !== "SEARCHING_DRIVER") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          message: "Este servicio ya no está disponible para aceptar"
        });
      }

      const result = await client.query(
        `
        UPDATE bhuz_services
        SET
          status = 'DRIVER_ASSIGNED',
          driver_id = $1,
          driver_name = $2,
          driver_phone = $3,
          updated_at = NOW()
        WHERE id = $4
          AND status = 'SEARCHING_DRIVER'
        RETURNING *
        `,
        [driverId, driverName, driverPhone, serviceId]
      );

      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, message: "Otro repartidor ya aceptó este servicio" });
      }

      await insertarHistorial(client, {
        serviceId,
        previousStatus: service.status,
        newStatus: "DRIVER_ASSIGNED",
        changedBy: driverId,
        notes: `Servicio aceptado por ${driverName}`
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Servicio aceptado correctamente",
        service: mapearServicio(result.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error aceptando servicio:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error aceptando servicio",
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

      if (!puedeCambiarEstado(service.status, newStatus)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          message: `Transición no permitida: ${service.status} → ${newStatus}`
        });
      }

      const estadosDelRepartidor = new Set(["GOING_TO_PICKUP", "PACKAGE_PICKED", "GOING_TO_DELIVERY"]);
      if (estadosDelRepartidor.has(newStatus) && !esActorRepartidor(changedBy, service)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, message: "Solo el repartidor asignado puede actualizar este estado" });
      }

      if (newStatus === "CANCELLED" && ["PACKAGE_PICKED", "GOING_TO_DELIVERY", "DELIVERED"].includes(service.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, message: "El envío ya no puede cancelarse en este estado" });
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

      /*
        Integración directa paquete → panel repartidor.
        Antes se dependía de que el repartidor abriera su dashboard para
        intentar sincronizar el servicio. Ahora la tarea se crea en el mismo
        momento en que el cliente publica el envío.
      */
      if (newStatus === "SEARCHING_DRIVER") {
        await client.query(
          `
          INSERT INTO bhuz_delivery_jobs (
            id, source_type, source_id, status,
            pickup_name, pickup_address, pickup_reference, pickup_latitude, pickup_longitude,
            delivery_name, delivery_address, delivery_reference, delivery_latitude, delivery_longitude,
            distance_km, service_total, driver_earning, currency, payment_method, payment_received_by,
            created_at, updated_at
          )
          SELECT
            'job_' || s.id, 'PACKAGE', s.id, 'PENDING_ASSIGNMENT',
            COALESCE(NULLIF(s.customer_name, ''), 'Retiro de paquete'),
            s.pickup_address, s.pickup_reference, s.pickup_latitude, s.pickup_longitude,
            COALESCE(NULLIF(s.receiver_name, ''), 'Receptor'),
            s.delivery_address, s.delivery_reference, s.delivery_latitude, s.delivery_longitude,
            COALESCE(s.distance_km, 0), COALESCE(s.total_amount, 0),
            CASE
              WHEN COALESCE(s.driver_earning, 0) > 0 THEN s.driver_earning
              ELSE ROUND(COALESCE(s.total_amount, 0)::numeric * 0.10, 2)
            END,
            COALESCE(s.currency, 'USD'), s.payment_method, 'BHUZ', NOW(), NOW()
          FROM bhuz_services s
          WHERE s.id = $1
          ON CONFLICT (source_type, source_id) DO UPDATE SET
            status = CASE
              WHEN bhuz_delivery_jobs.driver_id IS NULL
               AND bhuz_delivery_jobs.status NOT IN ('DELIVERED','CANCELLED')
              THEN 'PENDING_ASSIGNMENT'
              ELSE bhuz_delivery_jobs.status
            END,
            pickup_name = EXCLUDED.pickup_name,
            pickup_address = EXCLUDED.pickup_address,
            pickup_reference = EXCLUDED.pickup_reference,
            pickup_latitude = EXCLUDED.pickup_latitude,
            pickup_longitude = EXCLUDED.pickup_longitude,
            delivery_name = EXCLUDED.delivery_name,
            delivery_address = EXCLUDED.delivery_address,
            delivery_reference = EXCLUDED.delivery_reference,
            delivery_latitude = EXCLUDED.delivery_latitude,
            delivery_longitude = EXCLUDED.delivery_longitude,
            distance_km = EXCLUDED.distance_km,
            service_total = EXCLUDED.service_total,
            driver_earning = EXCLUDED.driver_earning,
            currency = EXCLUDED.currency,
            payment_method = EXCLUDED.payment_method,
            updated_at = NOW()
          `,
          [serviceId]
        );
      }

      if (newStatus === "CANCELLED") {
        await client.query(
          `UPDATE bhuz_delivery_jobs
           SET status='CANCELLED', updated_at=NOW()
           WHERE source_type='PACKAGE' AND source_id=$1
             AND status NOT IN ('DELIVERED','CANCELLED')`,
          [serviceId]
        );
      }

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

      if (service.status !== "GOING_TO_DELIVERY") {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, message: "La entrega solo puede confirmarse cuando el paquete va hacia el receptor" });
      }

      if (!driverId || String(service.driver_id || "") !== driverId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, message: "Solo el repartidor asignado puede confirmar la entrega" });
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







