const { hashPassword, verifyPassword } = require("../utils/passwords");
const express = require("express");

/* ======================================================
   RUTAS USUARIOS
   - Lee usuarios desde PostgreSQL.
   - Permite actualizar datos del perfil del cliente.
   - El correo NO se edita porque es la llave principal del usuario.
   - Permite cambiar contraseña validando contraseña actual.
   - No cambia login, registro, admin, pedidos ni restaurantes.
====================================================== */

let fallbackPool = null;

try {
  fallbackPool = require("../db/postgres").pool;
} catch (error) {
  fallbackPool = null;
}

function crearRutasUsuarios(dependencias) {
  const router = express.Router();

  const {
    normalizeEmail,
    getUsersFromPostgres,
    getUserByEmailFromPostgres
  } = dependencias;

  const pool = dependencias.pool || fallbackPool;
  const normalizeText = dependencias.normalizeText || ((value) => String(value || "").trim());
  const mapDbUser = dependencias.mapDbUser || ((row) => ({
    id: row.id || "",
    fullName: row.full_name || row.name || "",
    name: row.name || row.full_name || "",
    address: row.address || "",
    phone: row.phone || "",
    email: normalizeEmail(row.email),
    role: row.role || "customer",
    status: row.status || "active",
    reference: row.reference || "",
    location: {
      lat: row.latitude || "",
      lng: row.longitude || ""
    },
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  }));

  function cleanText(value) {
    return String(value || "").trim();
  }

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

  /* ======================================================
     PUT /users/:email
     Actualiza perfil del usuario.

     PERMITIDO:
     - nombre completo
     - teléfono
     - contraseña, solo con contraseña actual válida

     BLOQUEADO:
     - correo electrónico

     NOTA:
     - La dirección completa se edita en /users/:email/addresses/:addressId
       porque el sistema usa user_addresses como fuente real de direcciones.
  ====================================================== */
  router.put("/:email", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    const {
      fullName,
      name,
      phone,
      currentPassword,
      newPassword
    } = req.body || {};

    const finalName = cleanText(fullName || name);
    const finalPhone = cleanText(phone);
    const finalCurrentPassword = String(currentPassword || "");
    const finalNewPassword = String(newPassword || "");

    if (!pool) {
      return res.status(500).json({
        ok: false,
        message: "No hay conexión disponible con PostgreSQL para actualizar el perfil"
      });
    }

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Correo de usuario inválido"
      });
    }

    if (!finalName || !finalPhone) {
      return res.status(400).json({
        ok: false,
        message: "Nombre y teléfono son obligatorios"
      });
    }

    if (finalNewPassword && finalNewPassword.length < 6) {
      return res.status(400).json({
        ok: false,
        message: "La nueva contraseña debe tener mínimo 6 caracteres"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentResult = await client.query(
        `
        SELECT *
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [email]
      );

      if (!currentResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Usuario no encontrado"
        });
      }

      const currentUser = currentResult.rows[0];

      if (finalNewPassword) {
        if (!finalCurrentPassword) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            ok: false,
            message: "Debes escribir tu contraseña actual para cambiarla"
          });
        }

        if (!(await verifyPassword(finalCurrentPassword, currentUser.password))) {
          await client.query("ROLLBACK");

          return res.status(401).json({
            ok: false,
            message: "La contraseña actual no es correcta"
          });
        }
      }

      const updatedResult = await client.query(
        `
        UPDATE users
        SET full_name = $1,
            name = $1,
            phone = $2,
            password = CASE WHEN $3 = '' THEN password ELSE $3 END,
            updated_at = NOW()
        WHERE LOWER(email) = LOWER($4)
        RETURNING *
        `,
        [
          normalizeText(finalName),
          normalizeText(finalPhone),
          finalNewPassword ? await hashPassword(finalNewPassword) : "",
          email
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Perfil actualizado correctamente",
        user: mapDbUser(updatedResult.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error actualizando perfil del usuario:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error actualizando perfil del usuario",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = crearRutasUsuarios;


