const express = require("express");

/* ======================================================
   RUTAS AUTH / SESIÓN
   - Este archivo separa login, registro y sesión.
   - Mantiene las mismas rutas públicas que ya usa el frontend.
   - No cambia platos, pedidos, admin ni estadísticas.
====================================================== */

function crearRutasAuth(dependencias) {
  const router = express.Router();

  const {
    pool,
    normalizeEmail,
    normalizeText,
    generateId,
    mapDbUser,
    mapDbRestaurant,
    getUserByEmailFromPostgres,
    getRestaurantByEmailFromPostgres,
    getSessionUser,
    createSession,
    clearSession
  } = dependencias;

  /* ======================================================
     GET /session
     Verifica sesión activa.
  ====================================================== */
  router.get("/session", async (req, res) => {
    const session = await getSessionUser(req);

    if (!session) {
      return res.status(401).json({
        ok: false,
        message: "No hay sesión activa"
      });
    }

    res.json({
      ok: true,
      type: session.type,
      user: session.user,
      admin: session.type === "admin" ? session.user : null
    });
  });

  /* ======================================================
     POST /logout
     Cierra sesión.
  ====================================================== */
  router.post("/logout", (req, res) => {
    clearSession(req, res);

    res.json({
      ok: true,
      message: "Sesión cerrada"
    });
  });

  /* ======================================================
     POST /register
     Registro de cliente.
  ====================================================== */
  router.post("/register", async (req, res) => {
    const {
      fullName,
      address,
      phone,
      email,
      password,
      reference,
      location
    } = req.body || {};

    if (!fullName || !address || !phone || !email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Faltan campos obligatorios"
      });
    }

    const normalizedEmail = normalizeEmail(email);

    try {
      const exists = await pool.query(
        `
        SELECT email FROM users WHERE LOWER(email) = LOWER($1)
        UNION
        SELECT email FROM restaurants WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [normalizedEmail]
      );

      if (exists.rows.length) {
        return res.status(409).json({
          ok: false,
          message: "Ese correo ya está registrado"
        });
      }

      const newUser = {
        id: generateId("user"),
        fullName: normalizeText(fullName),
        name: normalizeText(fullName),
        address: normalizeText(address),
        phone: normalizeText(phone),
        email: normalizedEmail,
        password: String(password),
        role: "customer",
        status: "active",
        reference: normalizeText(reference),
        location: {
          lat: location?.lat || "",
          lng: location?.lng || ""
        },
        createdAt: new Date().toISOString()
      };

      const result = await pool.query(
        `
        INSERT INTO users (
          id, full_name, name, email, password, phone, address, reference,
          role, status, latitude, longitude, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
        RETURNING *
        `,
        [
          newUser.id,
          newUser.fullName,
          newUser.name,
          newUser.email,
          newUser.password,
          newUser.phone,
          newUser.address,
          newUser.reference,
          newUser.role,
          newUser.status,
          newUser.location.lat,
          newUser.location.lng
        ]
      );

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Usuario registrado correctamente",
        user: mapDbUser(result.rows[0])
      });
    } catch (error) {
      console.error("Error registrando usuario en PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error registrando usuario en PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     POST /register-restaurant
     Registro de restaurante.
  ====================================================== */
  router.post("/register-restaurant", async (req, res) => {
    const { name, address, phone, email, password } = req.body || {};

    if (!name || !address || !phone || !email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Faltan campos obligatorios"
      });
    }

    const normalizedEmail = normalizeEmail(email);

    try {
      const exists = await pool.query(
        `
        SELECT email FROM users WHERE LOWER(email) = LOWER($1)
        UNION
        SELECT email FROM restaurants WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [normalizedEmail]
      );

      if (exists.rows.length) {
        return res.status(409).json({
          ok: false,
          message: "Ese correo ya está registrado"
        });
      }

      const result = await pool.query(
        `
        INSERT INTO restaurants (
          id, name, email, password, phone, address, role, status,
          commission, commission_percent, open, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        RETURNING *
        `,
        [
          generateId("restaurant"),
          normalizeText(name),
          normalizedEmail,
          String(password),
          normalizeText(phone),
          normalizeText(address),
          "restaurant",
          "pending",
          15,
          15,
          true
        ]
      );

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: "Restaurante registrado correctamente",
        restaurant: mapDbRestaurant(result.rows[0])
      });
    } catch (error) {
      console.error("Error registrando restaurante en PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error registrando restaurante en PostgreSQL",
        error: error.message
      });
    }
  });

  /* ======================================================
     POST /login
     Login cliente / restaurante.
  ====================================================== */
  router.post("/login", async (req, res) => {
    const { role, email, password } = req.body || {};

    if (!role || !email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Faltan credenciales"
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedRole = String(role || "").trim().toLowerCase();

    try {
      if (normalizedRole === "restaurant" || normalizedRole === "restaurante") {
        const restaurant = await getRestaurantByEmailFromPostgres(normalizedEmail);

        if (!restaurant || String(restaurant.password) !== String(password)) {
          return res.status(401).json({
            ok: false,
            message: "Datos inválidos para restaurante"
          });
        }

        if (restaurant.status && restaurant.status !== "approved") {
          return res.status(403).json({
            ok: false,
            message:
              restaurant.status === "blocked"
                ? "Tu restaurante está bloqueado. Contacta con DELI GO."
                : "Tu restaurante está pendiente de aprobación administrativa."
          });
        }

        const sessionUser = { ...restaurant, role: "restaurant" };
        createSession(res, sessionUser, "user");

        return res.json({
          ok: true,
          source: "postgres",
          message: "Login correcto",
          user: sessionUser
        });
      }

      const user = await getUserByEmailFromPostgres(normalizedEmail);

      if (!user || String(user.password) !== String(password)) {
        return res.status(401).json({
          ok: false,
          message: "Correo o contraseña incorrectos"
        });
      }

      const sessionUser = { ...user, role: "customer" };
      createSession(res, sessionUser, "user");

      return res.json({
        ok: true,
        source: "postgres",
        message: "Login correcto",
        user: sessionUser
      });
    } catch (error) {
      console.error("Error en login PostgreSQL:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Error en login PostgreSQL",
        error: error.message
      });
    }
  });

  return router;
}

module.exports = crearRutasAuth;
