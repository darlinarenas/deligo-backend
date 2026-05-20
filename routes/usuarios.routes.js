const express = require("express");

const express = require("express");

/* ======================================================
   RUTAS USUARIOS
   - Este archivo separa SOLO las rutas de usuarios.
   - Mantiene las mismas respuestas que ya usa el frontend.
   - No cambia login, registro, admin, pedidos ni restaurantes.
   - CAMBIO BHUZ: agrega actualización segura de perfil y contraseña.
====================================================== */

function crearRutasUsuarios(dependencias) {
  const router = express.Router();

  const {
    pool,
    normalizeEmail,
    normalizeText,
    getUsersFromPostgres,
    getUserByEmailFromPostgres,
    createSession
  } = dependencias;

  function cleanText(value) {
    const raw = String(value || "").trim();

    if (!raw) return "";

    if (typeof normalizeText === "function") {
      return normalizeText(raw);
    }

    return raw;
  }

  function mapUpdatedUser(row) {
    if (!row) return null;

    return {
      id: row.id,
      fullName: row.full_name || row.name || "",
      name: row.name || row.full_name || "",
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      reference: row.reference || "",
      latitude: row.latitude || "",
      longitude: row.longitude || "",
      role: row.role || "customer",
      status: row.status || "active",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
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
     Actualiza datos personales del usuario.

     Permite:
     - nombre completo
     - teléfono
     - contraseña

     Reglas:
     - El correo NO se cambia porque conecta users, user_addresses y orders.
     - Para cambiar contraseña exige contraseña actual.
     - Mantiene PostgreSQL como fuente real.
     - Refresca la sesión si server.js entrega createSession.
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
    const wantsPasswordChange = Boolean(
      String(currentPassword || "").trim() || String(newPassword || "").trim()
    );

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Correo inválido"
      });
    }

    if (!finalName) {
      return res.status(400).json({
        ok: false,
        message: "El nombre no puede quedar vacío"
      });
    }

    if (!finalPhone) {
      return res.status(400).json({
        ok: false,
        message: "El teléfono no puede quedar vacío"
      });
    }

    if (wantsPasswordChange) {
      if (!String(currentPassword || "")) {
        return res.status(400).json({
          ok: false,
          message: "Escribe tu contraseña actual para cambiarla"
        });
      }

      if (!String(newPassword || "") || String(newPassword).length < 6) {
        return res.status(400).json({
          ok: false,
          message: "La nueva contraseña debe tener mínimo 6 caracteres"
        });
      }
    }

    if (!pool) {
      return res.status(500).json({
        ok: false,
        message: "No se recibió conexión PostgreSQL para actualizar usuario"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `
        SELECT *
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [email]
      );

      if (!existing.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Usuario no encontrado"
        });
      }

      const dbUser = existing.rows[0];

      if (wantsPasswordChange && String(dbUser.password) !== String(currentPassword)) {
        await client.query("ROLLBACK");

        return res.status(401).json({
          ok: false,
          message: "La contraseña actual no es correcta"
        });
      }

      const updateResult = await client.query(
        `
        UPDATE users
        SET
          full_name = $1,
          name = $2,
          phone = $3,
          password = CASE WHEN $4::boolean THEN $5 ELSE password END,
          updated_at = NOW()
        WHERE LOWER(email) = LOWER($6)
        RETURNING *
        `,
        [
          finalName,
          finalName,
          finalPhone,
          wantsPasswordChange,
          wantsPasswordChange ? String(newPassword) : null,
          email
        ]
      );

      await client.query("COMMIT");

      let user = null;

      try {
        user = await getUserByEmailFromPostgres(email);
      } catch (mapError) {
        user = mapUpdatedUser(updateResult.rows[0]);
      }

      if (!user) {
        user = mapUpdatedUser(updateResult.rows[0]);
      }

      if (typeof createSession === "function") {
        try {
          createSession(
            res,
            {
              ...user,
              role: user.role || "customer"
            },
            "user"
          );
        } catch (sessionError) {
          console.warn("Perfil actualizado, pero no se pudo refrescar sesión:", sessionError.message);
        }
      }

      return res.json({
        ok: true,
        source: "postgres",
        message: wantsPasswordChange
          ? "Perfil y contraseña actualizados correctamente"
          : "Perfil actualizado correctamente",
        user
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error actualizando usuario desde PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error actualizando usuario desde PostgreSQL",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = crearRutasUsuarios;

