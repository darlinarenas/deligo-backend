const express = require("express");

/* ======================================================
   RUTAS RESTAURANTES
   - Este archivo separa SOLO las rutas de restaurantes.
   - Mantiene las mismas respuestas que ya usa el frontend.
   - No cambia lógica de negocio.
   - No toca platos, pedidos, admin ni login.
====================================================== */

function crearRutasRestaurantes(dependencias) {
  const router = express.Router();

  const {
    normalizeEmail,
    getRestaurantsFromPostgres,
    getRestaurantByEmailFromPostgres
  } = dependencias;

  /* ======================================================
     GET /restaurants
     Lee todos los restaurantes desde PostgreSQL.
  ====================================================== */
  router.get("/", async (req, res) => {
    try {
      const restaurants = await getRestaurantsFromPostgres();

      return res.json({
        ok: true,
        source: "postgres",
        total: restaurants.length,
        restaurants
      });
    } catch (error) {
      console.error("Error leyendo restaurantes desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo restaurantes desde PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     GET /restaurants/:email
     Lee un restaurante por correo desde PostgreSQL.
  ====================================================== */
  router.get("/:email", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    try {
      const restaurant = await getRestaurantByEmailFromPostgres(email);

      if (!restaurant) {
        return res.status(404).json({
          ok: false,
          message: "Restaurante no encontrado"
        });
      }

      return res.json({
        ok: true,
        source: "postgres",
        restaurant
      });
    } catch (error) {
      console.error("Error leyendo restaurante desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo restaurante desde PostgreSQL",
        error: error.message
      });
    }
  });

  return router;
}

module.exports = crearRutasRestaurantes;
