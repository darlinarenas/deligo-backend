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

    const validStatuses = [
      "pendiente",
      "aceptado",
      "preparando",
      "listo",
      "en_camino",
      "entregado"
    ];

    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ ok: false, message: "Estado inválido" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE orders
         SET status = $1,
             ready_at = CASE WHEN $1='listo' THEN NOW() ELSE ready_at END,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [normalizedStatus, orderId]
      );

      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: "Pedido no encontrado" });
      }

      /*
        Restaurante → repartidor.
        Desde que el restaurante acepta/prepara/lista el pedido, se garantiza
        una tarea abierta para los repartidores. ON CONFLICT evita duplicados.
      */
      if (["aceptado", "preparando", "listo"].includes(normalizedStatus)) {
        const earning = Math.max(1.5, Math.round(Number(row.total || 0) * 0.10 * 100) / 100);

        await client.query(
          `INSERT INTO bhuz_delivery_jobs (
             id, source_type, source_id, status,
             pickup_name, pickup_address,
             delivery_name, delivery_address, delivery_reference,
             delivery_latitude, delivery_longitude,
             service_total, driver_earning, currency, payment_method,
             payment_received_by, estimated_pickup_at, created_at, updated_at
           )
           VALUES (
             'job_' || $1, 'FOOD_ORDER', $1, 'PENDING_ASSIGNMENT',
             COALESCE(NULLIF($2,''), 'Restaurante'), COALESCE(NULLIF($3,''), 'Dirección del restaurante pendiente'),
             COALESCE(NULLIF($4,''), 'Cliente'), COALESCE(NULLIF($5,''), $6, 'Dirección de entrega pendiente'), $7,
             NULLIF($8,'')::numeric, NULLIF($9,'')::numeric,
             COALESCE($10,0), $11, 'USD', $12, 'BHUZ',
             CASE WHEN $13='listo' THEN NOW() ELSE NULL END, NOW(), NOW()
           )
           ON CONFLICT (source_type, source_id) DO UPDATE SET
             status = CASE
               WHEN bhuz_delivery_jobs.driver_id IS NULL
                AND bhuz_delivery_jobs.status NOT IN ('DELIVERED','CANCELLED')
               THEN 'PENDING_ASSIGNMENT'
               ELSE bhuz_delivery_jobs.status
             END,
             pickup_name=EXCLUDED.pickup_name,
             pickup_address=EXCLUDED.pickup_address,
             delivery_name=EXCLUDED.delivery_name,
             delivery_address=EXCLUDED.delivery_address,
             delivery_reference=EXCLUDED.delivery_reference,
             delivery_latitude=EXCLUDED.delivery_latitude,
             delivery_longitude=EXCLUDED.delivery_longitude,
             service_total=EXCLUDED.service_total,
             driver_earning=EXCLUDED.driver_earning,
             payment_method=EXCLUDED.payment_method,
             estimated_pickup_at=COALESCE(EXCLUDED.estimated_pickup_at,bhuz_delivery_jobs.estimated_pickup_at),
             updated_at=NOW()
           RETURNING id`,
          [
            row.id, row.restaurant_name, row.restaurant_address,
            row.customer_name, row.delivery_address, row.customer_address,
            row.delivery_reference, String(row.latitude || ""), String(row.longitude || ""),
            Number(row.total || 0), earning, row.payment_method || "", normalizedStatus
          ]
        );

        const job = await client.query(
          `SELECT id FROM bhuz_delivery_jobs WHERE source_type='FOOD_ORDER' AND source_id=$1 LIMIT 1`,
          [row.id]
        );
        await client.query(
          `UPDATE orders
           SET delivery_status=CASE WHEN driver_id IS NULL THEN 'PENDING_ASSIGNMENT' ELSE delivery_status END,
               delivery_job_id=COALESCE(delivery_job_id,$2),
               driver_earning=CASE WHEN COALESCE(driver_earning,0)>0 THEN driver_earning ELSE $3 END,
               updated_at=NOW()
           WHERE id=$1`,
          [row.id, job.rows[0]?.id || null, earning]
        );
      }

      await client.query("COMMIT");
      const order = await getOrderByIdFromPostgres(orderId);

      return res.json({
        ok: true,
        source: "postgres",
        message: "Estado actualizado correctamente",
        order
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

