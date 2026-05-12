const express = require("express");

/* ======================================================
   RUTAS PLATOS
   - Este archivo separa SOLO las rutas de platos.
   - Mantiene las rutas reales del proyecto:
     /restaurants/:email/dishes
     /restaurants/:email/dishes/:dishId
   - No cambia respuestas del frontend.
   - No toca auth, pedidos, admin ni estadísticas.
====================================================== */

function crearRutasPlatos(dependencias) {
  const router = express.Router({ mergeParams: true });

  const {
    normalizeEmail,
    getDishesByRestaurantEmailFromPostgres,
    getRestaurantByEmailFromPostgres,
    createDishInPostgres,
    updateDishInPostgres,
    deleteDishFromPostgres
  } = dependencias;

  /* ======================================================
     GET /restaurants/:email/dishes
     Lee platos por restaurante desde PostgreSQL.
  ====================================================== */
  router.get("/", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    try {
      const restaurantDishes = await getDishesByRestaurantEmailFromPostgres(email);

      return res.json({
        ok: true,
        source: "postgres",
        total: restaurantDishes.length,
        dishes: restaurantDishes
      });
    } catch (error) {
      console.error("Error leyendo platos desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo platos desde PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     POST /restaurants/:email/dishes
     Crea plato del restaurante.
  ====================================================== */
  router.post("/", async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const body = req.body || {};

    if (!body.name || !body.price || !body.description || !body.category) {
      return res.status(400).json({
        ok: false,
        message: "Faltan campos obligatorios del plato"
      });
    }

    try {
      const restaurant = await getRestaurantByEmailFromPostgres(email);

      if (!restaurant) {
        return res.status(404).json({
          ok: false,
          message: "Restaurante no encontrado"
        });
      }

      const newDish = await createDishInPostgres(restaurant, body);

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Plato creado correctamente",
        dish: newDish
      });
    } catch (error) {
      console.error("Error creando plato en PostgreSQL:", error.message);

      return res.status(error.statusCode || 500).json({
        ok: false,
        message: error.message || "Error creando plato en PostgreSQL"
      });
    }
  });

  /* ======================================================
     PUT /restaurants/:email/dishes/:dishId
     Actualiza plato del restaurante.
  ====================================================== */
  router.put("/:dishId", async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const dishId = String(req.params.dishId || "").trim();
    const body = req.body || {};

    try {
      const updatedDish = await updateDishInPostgres(email, dishId, body);

      if (!updatedDish) {
        return res.status(404).json({
          ok: false,
          message: "Plato no encontrado"
        });
      }

      return res.json({
        ok: true,
        source: "postgres",
        message: "Plato actualizado correctamente",
        dish: updatedDish
      });
    } catch (error) {
      console.error("Error actualizando plato en PostgreSQL:", error.message);

      return res.status(error.statusCode || 500).json({
        ok: false,
        message: error.message || "Error actualizando plato en PostgreSQL"
      });
    }
  });

  /* ======================================================
     DELETE /restaurants/:email/dishes/:dishId
     Elimina plato del restaurante.
  ====================================================== */
  router.delete("/:dishId", async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const dishId = String(req.params.dishId || "").trim();

    try {
      const deletedDish = await deleteDishFromPostgres(email, dishId);

      if (!deletedDish) {
        return res.status(404).json({
          ok: false,
          message: "Plato no encontrado"
        });
      }

      return res.json({
        ok: true,
        source: "postgres",
        message: "Plato eliminado correctamente",
        dish: deletedDish
      });
    } catch (error) {
      console.error("Error eliminando plato en PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error eliminando plato en PostgreSQL",
        error: error.message
      });
    }
  });

  return router;
}

module.exports = crearRutasPlatos;

