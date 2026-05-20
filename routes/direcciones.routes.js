const express = require("express");

/* ======================================================
   RUTAS DIRECCIONES DE USUARIO - BHUZ
   - Gestiona varias direcciones de entrega por cliente.
   - PostgreSQL es la fuente real.
   - Cada dirección guarda texto + referencia + GPS.
   - Preparado para checkout e "Invitar comida".
====================================================== */

function crearRutasDirecciones(dependencias) {
  const router = express.Router({ mergeParams: true });

  const {
    pool,
    normalizeEmail,
    normalizeText,
    generateId
  } = dependencias;

  function mapDbAddress(row) {
    if (!row) return null;

    return {
      id: row.id || "",
      userEmail: normalizeEmail(row.user_email),
      label: row.label || "Casa",
      address: row.address || "",
      reference: row.reference || "",
      latitude: row.latitude || "",
      longitude: row.longitude || "",
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      location: {
        lat: row.latitude || "",
        lng: row.longitude || ""
      }
    };
  }

  function normalizeBoolean(value) {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  async function ensureUserExists(email) {
    const result = await pool.query(
      `
      SELECT email
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    return Boolean(result.rows.length);
  }

  /* ======================================================
     GET /users/:email/addresses
     Lista direcciones guardadas de un cliente.
  ====================================================== */
  router.get("/", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Correo de usuario inválido"
      });
    }

    try {
      const userExists = await ensureUserExists(email);

      if (!userExists) {
        return res.status(404).json({
          ok: false,
          message: "Usuario no encontrado"
        });
      }

      const result = await pool.query(
        `
        SELECT *
        FROM user_addresses
        WHERE LOWER(user_email) = LOWER($1)
        ORDER BY is_default DESC, created_at DESC
        `,
        [email]
      );

      return res.json({
        ok: true,
        source: "postgres",
        total: result.rows.length,
        addresses: result.rows.map(mapDbAddress)
      });
    } catch (error) {
      console.error("Error leyendo direcciones del usuario:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error leyendo direcciones del usuario",
        error: error.message
      });
    }
  });

  /* ======================================================
     POST /users/:email/addresses
     Crea una nueva dirección de entrega.
     GPS obligatorio.
  ====================================================== */
  router.post("/", async (req, res) => {
    const email = normalizeEmail(req.params.email);

    const {
      label,
      address,
      reference,
      latitude,
      longitude,
      location,
      isDefault
    } = req.body || {};

    const finalLabel = normalizeText(label || "Casa");
    const finalAddress = normalizeText(address);
    const finalReference = normalizeText(reference);
    const finalLatitude = String(latitude || location?.lat || "").trim();
    const finalLongitude = String(longitude || location?.lng || "").trim();
    const shouldBeDefault = normalizeBoolean(isDefault);

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Correo de usuario inválido"
      });
    }

    if (!finalAddress || !finalReference || !finalLatitude || !finalLongitude) {
      return res.status(400).json({
        ok: false,
        message: "Dirección, referencia y ubicación GPS son obligatorias"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userExistsResult = await client.query(
        `
        SELECT email
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [email]
      );

      if (!userExistsResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Usuario no encontrado"
        });
      }

      const countResult = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM user_addresses
        WHERE LOWER(user_email) = LOWER($1)
        `,
        [email]
      );

      const isFirstAddress = Number(countResult.rows[0]?.total || 0) === 0;
      const finalDefault = shouldBeDefault || isFirstAddress;

      if (finalDefault) {
        await client.query(
          `
          UPDATE user_addresses
          SET is_default = false, updated_at = NOW()
          WHERE LOWER(user_email) = LOWER($1)
          `,
          [email]
        );
      }

      const insertResult = await client.query(
        `
        INSERT INTO user_addresses (
          id, user_email, label, address, reference,
          latitude, longitude, is_default, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        RETURNING *
        `,
        [
          generateId("address"),
          email,
          finalLabel || "Casa",
          finalAddress,
          finalReference,
          finalLatitude,
          finalLongitude,
          finalDefault
        ]
      );

      if (finalDefault) {
        await client.query(
          `
          UPDATE users
          SET address = $1,
              reference = $2,
              latitude = $3,
              longitude = $4,
              updated_at = NOW()
          WHERE LOWER(email) = LOWER($5)
          `,
          [
            finalAddress,
            finalReference,
            finalLatitude,
            finalLongitude,
            email
          ]
        );
      }

      await client.query("COMMIT");

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Dirección guardada correctamente",
        address: mapDbAddress(insertResult.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error guardando dirección del usuario:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error guardando dirección del usuario",
        error: error.message
      });
    } finally {
      client.release();
    }
  });


  /* ======================================================
     PUT /users/:email/addresses/:addressId
     Edita una dirección guardada existente.
     - Permite cambiar alias, dirección, referencia y GPS.
     - Si queda como principal, también actualiza users.
     - Evita el reemplazo inseguro de crear y borrar cuando solo hay una dirección.
  ====================================================== */
  router.put("/:addressId", async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const addressId = String(req.params.addressId || "").trim();

    const {
      label,
      address,
      reference,
      latitude,
      longitude,
      location,
      isDefault
    } = req.body || {};

    const finalLabel = normalizeText(label || "Casa");
    const finalAddress = normalizeText(address);
    const finalReference = normalizeText(reference);
    const finalLatitude = String(latitude || location?.lat || "").trim();
    const finalLongitude = String(longitude || location?.lng || "").trim();
    const shouldBeDefault = normalizeBoolean(isDefault);

    if (!email || !addressId) {
      return res.status(400).json({
        ok: false,
        message: "Datos inválidos para editar dirección"
      });
    }

    if (!finalAddress || !finalReference || !finalLatitude || !finalLongitude) {
      return res.status(400).json({
        ok: false,
        message: "Dirección, referencia y ubicación GPS son obligatorias"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const addressResult = await client.query(
        `
        SELECT *
        FROM user_addresses
        WHERE id = $1
          AND LOWER(user_email) = LOWER($2)
        LIMIT 1
        `,
        [addressId, email]
      );

      if (!addressResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Dirección no encontrada"
        });
      }

      const previousAddress = addressResult.rows[0];
      const finalDefault = shouldBeDefault || Boolean(previousAddress.is_default);

      if (finalDefault) {
        await client.query(
          `
          UPDATE user_addresses
          SET is_default = false, updated_at = NOW()
          WHERE LOWER(user_email) = LOWER($1)
          `,
          [email]
        );
      }

      const updatedResult = await client.query(
        `
        UPDATE user_addresses
        SET label = $1,
            address = $2,
            reference = $3,
            latitude = $4,
            longitude = $5,
            is_default = $6,
            updated_at = NOW()
        WHERE id = $7
          AND LOWER(user_email) = LOWER($8)
        RETURNING *
        `,
        [
          finalLabel || "Casa",
          finalAddress,
          finalReference,
          finalLatitude,
          finalLongitude,
          finalDefault,
          addressId,
          email
        ]
      );

      const updatedAddress = updatedResult.rows[0];

      if (finalDefault) {
        await client.query(
          `
          UPDATE users
          SET address = $1,
              reference = $2,
              latitude = $3,
              longitude = $4,
              updated_at = NOW()
          WHERE LOWER(email) = LOWER($5)
          `,
          [
            updatedAddress.address,
            updatedAddress.reference,
            updatedAddress.latitude,
            updatedAddress.longitude,
            email
          ]
        );
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Dirección actualizada correctamente",
        address: mapDbAddress(updatedAddress)
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error actualizando dirección del usuario:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error actualizando dirección del usuario",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  /* ======================================================
     PUT /users/:email/addresses/:addressId/default
     Marca una dirección como predeterminada.
  ====================================================== */
  router.put("/:addressId/default", async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const addressId = String(req.params.addressId || "").trim();

    if (!email || !addressId) {
      return res.status(400).json({
        ok: false,
        message: "Datos inválidos para marcar dirección predeterminada"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const addressResult = await client.query(
        `
        SELECT *
        FROM user_addresses
        WHERE id = $1
          AND LOWER(user_email) = LOWER($2)
        LIMIT 1
        `,
        [addressId, email]
      );

      if (!addressResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Dirección no encontrada"
        });
      }

      await client.query(
        `
        UPDATE user_addresses
        SET is_default = false, updated_at = NOW()
        WHERE LOWER(user_email) = LOWER($1)
        `,
        [email]
      );

      const updatedResult = await client.query(
        `
        UPDATE user_addresses
        SET is_default = true, updated_at = NOW()
        WHERE id = $1
          AND LOWER(user_email) = LOWER($2)
        RETURNING *
        `,
        [addressId, email]
      );

      const updatedAddress = updatedResult.rows[0];

      await client.query(
        `
        UPDATE users
        SET address = $1,
            reference = $2,
            latitude = $3,
            longitude = $4,
            updated_at = NOW()
        WHERE LOWER(email) = LOWER($5)
        `,
        [
          updatedAddress.address,
          updatedAddress.reference,
          updatedAddress.latitude,
          updatedAddress.longitude,
          email
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Dirección predeterminada actualizada",
        address: mapDbAddress(updatedAddress)
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error marcando dirección predeterminada:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error marcando dirección predeterminada",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  /* ======================================================
     DELETE /users/:email/addresses/:addressId
     Elimina una dirección.
     No permite eliminar la última dirección guardada.
  ====================================================== */
  router.delete("/:addressId", async (req, res) => {
    const email = normalizeEmail(req.params.email);
    const addressId = String(req.params.addressId || "").trim();

    if (!email || !addressId) {
      return res.status(400).json({
        ok: false,
        message: "Datos inválidos para eliminar dirección"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const countResult = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM user_addresses
        WHERE LOWER(user_email) = LOWER($1)
        `,
        [email]
      );

      if (Number(countResult.rows[0]?.total || 0) <= 1) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          ok: false,
          message: "No puedes eliminar la única dirección guardada"
        });
      }

      const deleteResult = await client.query(
        `
        DELETE FROM user_addresses
        WHERE id = $1
          AND LOWER(user_email) = LOWER($2)
        RETURNING *
        `,
        [addressId, email]
      );

      if (!deleteResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Dirección no encontrada"
        });
      }

      const deletedAddress = deleteResult.rows[0];

      if (deletedAddress.is_default) {
        const newDefaultResult = await client.query(
          `
          UPDATE user_addresses
          SET is_default = true, updated_at = NOW()
          WHERE id = (
            SELECT id
            FROM user_addresses
            WHERE LOWER(user_email) = LOWER($1)
            ORDER BY created_at DESC
            LIMIT 1
          )
          RETURNING *
          `,
          [email]
        );

        const newDefaultAddress = newDefaultResult.rows[0];

        if (newDefaultAddress) {
          await client.query(
            `
            UPDATE users
            SET address = $1,
                reference = $2,
                latitude = $3,
                longitude = $4,
                updated_at = NOW()
            WHERE LOWER(email) = LOWER($5)
            `,
            [
              newDefaultAddress.address,
              newDefaultAddress.reference,
              newDefaultAddress.latitude,
              newDefaultAddress.longitude,
              email
            ]
          );
        }
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Dirección eliminada correctamente",
        deletedAddress: mapDbAddress(deletedAddress)
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error eliminando dirección:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error eliminando dirección",
        error: error.message
      });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = crearRutasDirecciones;

