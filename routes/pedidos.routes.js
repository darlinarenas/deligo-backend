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
      return res.status(400).json({
        ok: false,
        message: "Estado inválido"
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE orders
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [normalizedStatus, orderId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          ok: false,
          message: "Pedido no encontrado"
        });
      }

      const order = await getOrderByIdFromPostgres(orderId);

      return res.json({
        ok: true,
        source: "postgres",
        message: "Estado actualizado correctamente",
        order
      });
    } catch (error) {
      console.error("Error actualizando estado del pedido en PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error actualizando estado del pedido en PostgreSQL",
        error: error.message
      });
    }
  });

  return router;
}

module.exports = crearRutasPedidos;

