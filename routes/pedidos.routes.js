const express = require("express");

/* ======================================================
   RUTAS PEDIDOS
   - Este archivo separa SOLO las rutas de pedidos.
   - Mantiene la lógica real que ya funcionaba en server.js.
   - No cambia respuestas del frontend.
   - No toca auth, restaurantes, usuarios, admin ni estadísticas.
====================================================== */

function crearRutasPedidos(dependencias) {
  const router = express.Router();

  const {
    pool,
    normalizeEmail,
    normalizeOrderStatus,
    createOrderInPostgres,
    getOrdersFromPostgres,
    getOrderByIdFromPostgres
  } = dependencias;

  /* ======================================================
     POST /orders
     Crea pedido en PostgreSQL usando orders + order_items.
  ====================================================== */
  router.post("/", async (req, res) => {
    try {
      const newOrder = await createOrderInPostgres(req.body || {});

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Pedido creado correctamente",
        order: newOrder
      });
    } catch (error) {
      console.error("Error creando pedido en PostgreSQL:", error.message);

      return res.status(error.statusCode || 500).json({
        ok: false,
        message: error.message || "Error creando pedido en PostgreSQL"
      });
    }
  });

  /* ======================================================
     GET /orders
     Lee todos los pedidos desde PostgreSQL.
     IMPORTANTE:
     Se mantiene la respuesta como arreglo directo porque así estaba.
  ====================================================== */
  router.get("/", async (req, res) => {
    try {
      const orders = await getOrdersFromPostgres();
      return res.json(orders);
    } catch (error) {
      console.error("Error leyendo pedidos desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo pedidos desde PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     GET /orders/restaurant/:email
     Lee pedidos por restaurante.
  ====================================================== */
  router.get("/restaurant/:email", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    try {
      const orders = await getOrdersFromPostgres({ restaurantEmail: email });

      return res.json({
        ok: true,
        source: "postgres",
        total: orders.length,
        orders
      });
    } catch (error) {
      console.error("Error leyendo pedidos del restaurante desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo pedidos del restaurante desde PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     GET /orders/customer/:email
     Lee pedidos por cliente.
  ====================================================== */
  router.get("/customer/:email", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    try {
      const orders = await getOrdersFromPostgres({ customerEmail: email });

      return res.json({
        ok: true,
        source: "postgres",
        total: orders.length,
        orders
      });
    } catch (error) {
      console.error("Error leyendo pedidos del cliente desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo pedidos del cliente desde PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     PATCH /orders/:id/status
     Cambia estado de pedido.
  ====================================================== */
  router.patch("/:id/status", async (req, res) => {
    const orderId = String(req.params.id || "").trim();
    const normalizedStatus = normalizeOrderStatus(req.body?.status);

    // El restaurante controla el pedido únicamente hasta confirmar
    // que fue retirado. Desde ese punto, el repartidor controla
    // "en_camino" y "entregado" desde su propio módulo.
    const validStatuses = [
      "pendiente",
      "aceptado",
      "preparando",
      "listo",
      "retirado"
    ];

    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ ok: false, message: "Estado inválido" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        UPDATE orders
        SET
          status = $1,
          accepted_at = CASE WHEN $1 = 'aceptado' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
          preparing_at = CASE WHEN $1 = 'preparando' THEN COALESCE(preparing_at, NOW()) ELSE preparing_at END,
          ready_at = CASE WHEN $1 = 'listo' THEN COALESCE(ready_at, NOW()) ELSE ready_at END,
          picked_up_at = CASE WHEN $1 = 'retirado' THEN COALESCE(picked_up_at, NOW()) ELSE picked_up_at END,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [normalizedStatus, orderId]
      );

      const orderRow = result.rows[0];
      if (!orderRow) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Pedido no encontrado" });
      }

      let deliveryJob = null;

      if (normalizedStatus === "retirado") {
        const jobResult = await client.query(
          `
          SELECT *
          FROM bhuz_delivery_jobs
          WHERE source_type = 'FOOD_ORDER' AND source_id = $1
          FOR UPDATE
          `,
          [orderRow.id]
        );

        const job = jobResult.rows[0];
        if (!job || !job.driver_id) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            message: "El pedido todavía no tiene un repartidor asignado."
          });
        }

        if (!["ASSIGNED", "GOING_TO_PICKUP", "ARRIVED_AT_PICKUP", "PICKED_UP"].includes(job.status)) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            message: "El pedido no puede marcarse como retirado en su estado actual."
          });
        }

        const updatedJob = await client.query(
          `
          UPDATE bhuz_delivery_jobs
          SET
            status = 'PICKED_UP',
            picked_up_at = COALESCE(picked_up_at, NOW()),
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [job.id]
        );

        deliveryJob = updatedJob.rows[0] || null;

        await client.query(
          `
          UPDATE orders
          SET
            delivery_status = 'PICKED_UP',
            picked_up_at = COALESCE(picked_up_at, NOW()),
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderRow.id]
        );
      }

      if (["aceptado", "preparando", "listo"].includes(normalizedStatus)) {
        const restaurantResult = await client.query(
          `SELECT address FROM restaurants WHERE id = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
          [orderRow.restaurant_id || "", orderRow.restaurant_email || ""]
        );
        const restaurantAddress = restaurantResult.rows[0]?.address || "";
        const earning = Number(orderRow.driver_earning || 0) || Math.max(1.5, Math.round(Number(orderRow.total || 0) * 0.10 * 100) / 100);
        const jobId = `job_${Date.now()}_${Math.random().toString(16).slice(2, 12)}`;

        const jobResult = await client.query(
          `
          INSERT INTO bhuz_delivery_jobs (
            id, source_type, source_id, assignment_mode, status, priority,
            pickup_name, pickup_address,
            delivery_name, delivery_address, delivery_reference,
            delivery_latitude, delivery_longitude,
            service_total, driver_earning, currency,
            payment_method, payment_received_by, estimated_pickup_at,
            created_at, updated_at
          )
          VALUES (
            $1, 'FOOD_ORDER', $2, 'OPEN', 'PENDING_ASSIGNMENT', 0,
            $3, $4,
            $5, $6, $7,
            $8, $9,
            $10, $11, 'USD',
            $12, 'BHUZ', CASE WHEN $13 = 'listo' THEN NOW() ELSE NULL END,
            NOW(), NOW()
          )
          ON CONFLICT (source_type, source_id) DO UPDATE SET
            status = CASE
              WHEN bhuz_delivery_jobs.status IN ('DELIVERED','CANCELLED') THEN bhuz_delivery_jobs.status
              ELSE bhuz_delivery_jobs.status
            END,
            pickup_name = EXCLUDED.pickup_name,
            pickup_address = EXCLUDED.pickup_address,
            delivery_name = EXCLUDED.delivery_name,
            delivery_address = EXCLUDED.delivery_address,
            delivery_reference = EXCLUDED.delivery_reference,
            delivery_latitude = EXCLUDED.delivery_latitude,
            delivery_longitude = EXCLUDED.delivery_longitude,
            service_total = EXCLUDED.service_total,
            driver_earning = EXCLUDED.driver_earning,
            payment_method = EXCLUDED.payment_method,
            estimated_pickup_at = CASE WHEN $13 = 'listo' THEN NOW() ELSE bhuz_delivery_jobs.estimated_pickup_at END,
            updated_at = NOW()
          RETURNING *
          `,
          [
            jobId,
            orderRow.id,
            orderRow.restaurant_name || "Restaurante",
            restaurantAddress,
            orderRow.customer_name || "Cliente",
            orderRow.delivery_address || orderRow.customer_address || "",
            orderRow.delivery_reference || "",
            orderRow.latitude || null,
            orderRow.longitude || null,
            Number(orderRow.total || 0),
            earning,
            orderRow.payment_method || "",
            normalizedStatus
          ]
        );

        deliveryJob = jobResult.rows[0] || null;
        await client.query(
          `UPDATE orders SET delivery_status = CASE WHEN delivery_status IN ('ASSIGNED','GOING_TO_PICKUP','PICKED_UP','GOING_TO_DELIVERY','DELIVERED') THEN delivery_status ELSE 'PENDING_ASSIGNMENT' END, delivery_job_id = $2, driver_earning = $3, updated_at = NOW() WHERE id = $1`,
          [orderRow.id, deliveryJob?.id || null, earning]
        );
      }

      await client.query("COMMIT");
      const order = await getOrderByIdFromPostgres(orderId);

      return res.json({
        ok: true,
        source: "postgres",
        message: "Estado actualizado correctamente",
        order,
        deliveryJob
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error actualizando estado del pedido en PostgreSQL:", error.message);
      return res.status(500).json({
        ok: false,
        message: "Error actualizando estado del pedido en PostgreSQL",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = crearRutasPedidos;

