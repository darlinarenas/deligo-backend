const express = require("express");

/* ======================================================
   RUTAS USUARIOS
   - Este archivo separa SOLO las rutas de usuarios.
   - Mantiene las mismas respuestas que ya usa el frontend.
   - No cambia login, registro, admin, pedidos ni restaurantes.
====================================================== */

function crearRutasUsuarios(dependencias) {
  const router = express.Router();

  const {
    normalizeEmail,
    getUsersFromPostgres,
    getUserByEmailFromPostgres
  } = dependencias;

  /* ======================================================
     GET /users
     Lee todos los usuarios desde PostgreSQL.
  ====================================================== */
  router.get("/", async (req, res) => {
    try {
      const users = await getUsersFromPostgres();

      return res.json({
        ok: true,
        source: "postgres",
        total: users.length,
        users
      });
    } catch (error) {
      console.error("Error leyendo usuarios desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo usuarios desde PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     GET /users/:email
     Lee un usuario por correo desde PostgreSQL.
  ====================================================== */
  router.get("/:email", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    try {
      const user = await getUserByEmailFromPostgres(email);

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "Usuario no encontrado"
        });
      }

      return res.json({
        ok: true,
        source: "postgres",
        user
      });
    } catch (error) {
      console.error("Error leyendo usuario desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo usuario desde PostgreSQL",
        error: error.message
      });
    }
  });

  return router;
}

module.exports = crearRutasUsuarios;
