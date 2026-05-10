console.log("SERVER NUEVO CON ADMIN ACTIVO");

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

/* ======================================================
   POSTGRESQL / SUPABASE
   - Conexión inicial segura.
   - Por ahora NO reemplaza JSON.
   - Solo permite probar conexión con /db-test.
   - DATABASE_URL debe estar configurada en Render.
====================================================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then((client) => {
    console.log("=================================");
    console.log("✅ PostgreSQL conectado correctamente");
    console.log("=================================");
    client.release();
  })
  .catch((error) => {
    console.error("❌ Error conectando PostgreSQL:", error.message);
  });

const ORDERS_FILE = path.join(__dirname, "orders.json");
const USERS_FILE = path.join(__dirname, "users.json");
const RESTAURANTS_FILE = path.join(__dirname, "restaurants.json");
const DISHES_FILE = path.join(__dirname, "dishes.json");
const ADMINS_FILE = path.join(__dirname, "admins.json");
const SESSIONS_FILE = path.join(__dirname, "sessions.json");

/* ======================================================
   POSTGRESQL - CREACIÓN SEGURA DE TABLAS BASE
   IMPORTANTE:
   - Esta fase NO reemplaza todavía los JSON.
   - Solo prepara la base de datos real para DELI GO.
   - Los endpoints actuales siguen funcionando igual con JSON.
   - Más adelante migraremos datos JSON -> PostgreSQL paso a paso.
====================================================== */
async function initDatabaseTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        phone TEXT,
        address TEXT,
        reference TEXT,
        role TEXT DEFAULT 'customer',
        status TEXT DEFAULT 'active',
        latitude TEXT,
        longitude TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        phone TEXT,
        address TEXT,
        category TEXT,
        description TEXT,
        role TEXT DEFAULT 'restaurant',
        status TEXT DEFAULT 'pending',
        commission NUMERIC DEFAULT 15,
        commission_percent NUMERIC DEFAULT 15,
        rating TEXT,
        delivery TEXT,
        time TEXT,
        open BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS dishes (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT,
        restaurant_email TEXT NOT NULL,
        restaurant_name TEXT,
        restaurant_address TEXT,
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC DEFAULT 0,
        category TEXT,
        prep_time TEXT,
        emoji TEXT,
        image TEXT,
        available BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        customer_email TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        customer_address TEXT,
        restaurant_id TEXT,
        restaurant_email TEXT NOT NULL,
        restaurant_name TEXT,
        status TEXT DEFAULT 'pendiente',
        total NUMERIC DEFAULT 0,
        payment_method TEXT,
        payment_status TEXT DEFAULT 'pendiente',
        notes TEXT,
        delivery_address TEXT,
        delivery_reference TEXT,
        latitude TEXT,
        longitude TEXT,
        date_text TEXT,
        time_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        dish_id TEXT,
        name_snapshot TEXT NOT NULL,
        price_snapshot NUMERIC DEFAULT 0,
        quantity NUMERIC DEFAULT 1,
        subtotal NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        role TEXT DEFAULT 'admin',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        admin_email TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      );
    `);

    console.log("✅ Tablas PostgreSQL verificadas/creadas correctamente");
  } catch (error) {
    console.error("❌ Error creando tablas PostgreSQL:", error.message);
  }
}


/* ======================================================
   POSTGRESQL - MIGRACIÓN SEGURA JSON -> POSTGRESQL
   IMPORTANTE:
   - Esta migración NO borra los archivos JSON.
   - Evita duplicados usando los mismos ID actuales.
   - Mantiene compatibilidad con el frontend actual.
   - Por ahora los endpoints siguen respondiendo desde JSON.
   - Esta fase solo copia los datos actuales a PostgreSQL.
====================================================== */
function toNullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toNumberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBooleanValue(value, fallback = true) {
  if (value === true || value === false) return value;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return fallback;
}

function toDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildAdminId(admin) {
  const email = normalizeEmail(admin?.email);
  return admin?.id || (email ? `admin_${email.replace(/[^a-z0-9]/gi, "_")}` : generateId("admin"));
}

async function migrateUsersToPostgres(client) {
  const users = readJsonArrayFile(USERS_FILE);

  for (const user of users) {
    const id = String(user.id || generateId("user")).trim();
    const email = normalizeEmail(user.email);
    if (!id || !email) continue;

    await client.query(
      `
      INSERT INTO users (
        id, full_name, name, email, password, phone, address, reference,
        role, status, latitude, longitude, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, NOW()),COALESCE($14::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        reference = EXCLUDED.reference,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        updated_at = COALESCE(EXCLUDED.updated_at, NOW())
      `,
      [
        id,
        toNullableText(user.fullName || user.name),
        toNullableText(user.name || user.fullName),
        email,
        String(user.password || ""),
        toNullableText(user.phone),
        toNullableText(user.address),
        toNullableText(user.reference),
        toNullableText(user.role || "customer"),
        toNullableText(user.status || "active"),
        toNullableText(user.location?.lat || user.latitude),
        toNullableText(user.location?.lng || user.longitude),
        toDateValue(user.createdAt),
        toDateValue(user.updatedAt)
      ]
    );
  }

  return users.length;
}

async function migrateRestaurantsToPostgres(client) {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  for (const restaurant of restaurants) {
    const id = String(restaurant.id || generateId("restaurant")).trim();
    const email = normalizeEmail(restaurant.email);
    if (!id || !email) continue;

    const commission = toNumberValue(
      restaurant.commissionPercent ?? restaurant.commission,
      15
    );

    await client.query(
      `
      INSERT INTO restaurants (
        id, name, email, password, phone, address, category, description,
        role, status, commission, commission_percent, rating, delivery, time,
        open, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE($17::timestamptz, NOW()),COALESCE($18::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        commission = EXCLUDED.commission,
        commission_percent = EXCLUDED.commission_percent,
        rating = EXCLUDED.rating,
        delivery = EXCLUDED.delivery,
        time = EXCLUDED.time,
        open = EXCLUDED.open,
        updated_at = COALESCE(EXCLUDED.updated_at, NOW())
      `,
      [
        id,
        toNullableText(restaurant.name) || "Restaurante",
        email,
        String(restaurant.password || ""),
        toNullableText(restaurant.phone),
        toNullableText(restaurant.address),
        toNullableText(restaurant.category || restaurant.type),
        toNullableText(restaurant.description),
        toNullableText(restaurant.role || "restaurant"),
        toNullableText(restaurant.status || "pending"),
        commission,
        commission,
        toNullableText(restaurant.rating),
        toNullableText(restaurant.delivery),
        toNullableText(restaurant.time),
        toBooleanValue(restaurant.open ?? restaurant.isOpen, true),
        toDateValue(restaurant.createdAt),
        toDateValue(restaurant.updatedAt)
      ]
    );
  }

  return restaurants.length;
}

async function migrateDishesToPostgres(client) {
  const dishes = readJsonArrayFile(DISHES_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  for (const dish of dishes) {
    const id = String(dish.id || generateId("dish")).trim();
    const restaurantEmail = normalizeEmail(dish.restaurantEmail);
    if (!id || !restaurantEmail || !dish.name) continue;

    const restaurant = restaurants.find((item) => normalizeEmail(item.email) === restaurantEmail);

    await client.query(
      `
      INSERT INTO dishes (
        id, restaurant_id, restaurant_email, restaurant_name, restaurant_address,
        name, description, price, category, prep_time, emoji, image, available,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz, NOW()),COALESCE($15::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        restaurant_id = EXCLUDED.restaurant_id,
        restaurant_email = EXCLUDED.restaurant_email,
        restaurant_name = EXCLUDED.restaurant_name,
        restaurant_address = EXCLUDED.restaurant_address,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        category = EXCLUDED.category,
        prep_time = EXCLUDED.prep_time,
        emoji = EXCLUDED.emoji,
        image = EXCLUDED.image,
        available = EXCLUDED.available,
        updated_at = COALESCE(EXCLUDED.updated_at, NOW())
      `,
      [
        id,
        toNullableText(restaurant?.id),
        restaurantEmail,
        toNullableText(dish.restaurantName || restaurant?.name),
        toNullableText(dish.restaurantAddress || restaurant?.address),
        toNullableText(dish.name) || "Plato",
        toNullableText(dish.description),
        toNumberValue(dish.price, 0),
        toNullableText(dish.category),
        toNullableText(dish.prepTime),
        toNullableText(dish.emoji),
        toNullableText(dish.image),
        toBooleanValue(dish.available, true),
        toDateValue(dish.createdAt),
        toDateValue(dish.updatedAt)
      ]
    );
  }

  return dishes.length;
}

async function migrateAdminsToPostgres(client) {
  const admins = readJsonArrayFile(ADMINS_FILE);

  for (const admin of admins) {
    const email = normalizeEmail(admin.email);
    if (!email) continue;

    const id = buildAdminId(admin);

    await client.query(
      `
      INSERT INTO admins (
        id, name, email, password, role, status, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()),COALESCE($8::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        updated_at = COALESCE(EXCLUDED.updated_at, NOW())
      `,
      [
        id,
        toNullableText(admin.name || "Administrador"),
        email,
        String(admin.password || ""),
        toNullableText(admin.role || "admin"),
        toNullableText(admin.status || "active"),
        toDateValue(admin.createdAt),
        toDateValue(admin.updatedAt)
      ]
    );
  }

  return admins.length;
}

async function migrateOrdersToPostgres(client) {
  const orders = readJsonArrayFile(ORDERS_FILE);
  const users = readJsonArrayFile(USERS_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  for (const order of orders) {
    const id = String(order.id || generateId("order")).trim();
    const restaurantEmail = normalizeEmail(order.restaurantEmail || order.restaurant?.email);
    if (!id || !restaurantEmail) continue;

    const customerEmail = normalizeEmail(order.customer?.email || order.userEmail);
    const user = users.find((item) => normalizeEmail(item.email) === customerEmail);
    const restaurant = restaurants.find((item) => normalizeEmail(item.email) === restaurantEmail);

    await client.query(
      `
      INSERT INTO orders (
        id, user_id, customer_email, customer_name, customer_phone, customer_address,
        restaurant_id, restaurant_email, restaurant_name, status, total,
        payment_method, payment_status, notes, delivery_address, delivery_reference,
        latitude, longitude, date_text, time_text, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,COALESCE($21::timestamptz, NOW()),COALESCE($22::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        customer_email = EXCLUDED.customer_email,
        customer_name = EXCLUDED.customer_name,
        customer_phone = EXCLUDED.customer_phone,
        customer_address = EXCLUDED.customer_address,
        restaurant_id = EXCLUDED.restaurant_id,
        restaurant_email = EXCLUDED.restaurant_email,
        restaurant_name = EXCLUDED.restaurant_name,
        status = EXCLUDED.status,
        total = EXCLUDED.total,
        payment_method = EXCLUDED.payment_method,
        payment_status = EXCLUDED.payment_status,
        notes = EXCLUDED.notes,
        delivery_address = EXCLUDED.delivery_address,
        delivery_reference = EXCLUDED.delivery_reference,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        date_text = EXCLUDED.date_text,
        time_text = EXCLUDED.time_text,
        updated_at = COALESCE(EXCLUDED.updated_at, NOW())
      `,
      [
        id,
        toNullableText(user?.id || order.userId),
        customerEmail || null,
        toNullableText(order.customer?.fullName || order.customer?.name),
        toNullableText(order.customer?.phone),
        toNullableText(order.customer?.address),
        toNullableText(restaurant?.id || order.restaurant?.id),
        restaurantEmail,
        toNullableText(order.restaurantName || restaurant?.name),
        toNullableText(order.status || "pendiente"),
        toNumberValue(order.total, 0),
        toNullableText(order.paymentMethod),
        toNullableText(order.paymentStatus || "pendiente"),
        toNullableText(order.notes),
        toNullableText(order.deliveryAddress || order.customer?.address),
        toNullableText(order.deliveryReference || order.customer?.reference),
        toNullableText(order.latitude || order.location?.lat || order.customer?.location?.lat),
        toNullableText(order.longitude || order.location?.lng || order.customer?.location?.lng),
        toNullableText(order.date),
        toNullableText(order.time),
        toDateValue(order.createdAt),
        toDateValue(order.updatedAt)
      ]
    );

    const items = Array.isArray(order.items) ? order.items : [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      const itemId = String(item.id || item.dishId || "").trim();
      const quantity = toNumberValue(item.qty ?? item.quantity, 1);
      const price = toNumberValue(item.price ?? item.unitPrice, 0);
      const subtotal = toNumberValue(item.subtotal, quantity * price);
      const orderItemId = `${id}_item_${index}_${itemId || "sin_id"}`;

      await client.query(
        `
        INSERT INTO order_items (
          id, order_id, dish_id, name_snapshot, price_snapshot,
          quantity, subtotal, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, NOW()))
        ON CONFLICT (id) DO UPDATE SET
          order_id = EXCLUDED.order_id,
          dish_id = EXCLUDED.dish_id,
          name_snapshot = EXCLUDED.name_snapshot,
          price_snapshot = EXCLUDED.price_snapshot,
          quantity = EXCLUDED.quantity,
          subtotal = EXCLUDED.subtotal
        `,
        [
          orderItemId,
          id,
          toNullableText(itemId),
          toNullableText(item.name || item.dishName) || "Producto",
          price,
          quantity,
          subtotal,
          toDateValue(order.createdAt)
        ]
      );
    }
  }

  return orders.length;
}

async function migrateJsonToPostgres() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = {
      users: await migrateUsersToPostgres(client),
      restaurants: await migrateRestaurantsToPostgres(client),
      dishes: await migrateDishesToPostgres(client),
      admins: await migrateAdminsToPostgres(client),
      orders: await migrateOrdersToPostgres(client)
    };

    await client.query("COMMIT");

    console.log("✅ Migración JSON -> PostgreSQL completada", result);
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error migrando JSON -> PostgreSQL:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function getDatabaseCounts() {
  const [users, restaurants, dishes, orders, orderItems, admins] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS total FROM users"),
    pool.query("SELECT COUNT(*)::int AS total FROM restaurants"),
    pool.query("SELECT COUNT(*)::int AS total FROM dishes"),
    pool.query("SELECT COUNT(*)::int AS total FROM orders"),
    pool.query("SELECT COUNT(*)::int AS total FROM order_items"),
    pool.query("SELECT COUNT(*)::int AS total FROM admins")
  ]);

  return {
    users: users.rows[0].total,
    restaurants: restaurants.rows[0].total,
    dishes: dishes.rows[0].total,
    orders: orders.rows[0].total,
    order_items: orderItems.rows[0].total,
    admins: admins.rows[0].total
  };
}

async function bootstrapDatabase() {
  try {
    await initDatabaseTables();
    await migrateJsonToPostgres();
  } catch (error) {
    console.error("❌ Bootstrap PostgreSQL falló sin detener el servidor:", error.message);
  }
}

bootstrapDatabase();


/* ======================================================
   CORS DEFINITIVO PARA FRONTEND EN VERCEL
   - Necesario porque el frontend usa credentials: "include".
   - NO se puede usar origin: "*" con cookies.
   - El backend debe responder con el origen exacto permitido.
====================================================== */
const ALLOWED_ORIGINS = [
  "https://deli-go-frontend-gamma.vercel.app",
  "https://deli-go-frontend-wheat.vercel.app",
  "https://deli-go.netlify.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/deli-go-frontend-[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/deli-go-frontend\.vercel\.app$/i
];

function isOriginAllowed(origin) {
  return (
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
  );
}

const corsOptions = {
  origin(origin, callback) {
    // Permite herramientas como Postman, navegador directo o health checks sin Origin.
    if (!origin) {
      return callback(null, true);
    }

    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origen no permitido por CORS: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  optionsSuccessStatus: 204
};

app.set("trust proxy", 1);
app.use(cors(corsOptions));
app.use(express.json());

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]", "utf-8");
  }
}

function readJsonArrayFile(filePath) {
  try {
    ensureFileExists(filePath);
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Error leyendo archivo:", filePath, error);
    return [];
  }
}

function writeJsonArrayFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error guardando archivo:", filePath, error);
  }
}

function readJsonObjectFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "{}", "utf-8");
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error("Error leyendo archivo objeto:", filePath, error);
    return {};
  }
}

function writeJsonObjectFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error guardando archivo objeto:", filePath, error);
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";

  return header.split(";").reduce((acc, part) => {
    const index = part.indexOf("=");
    if (index === -1) return acc;

    const key = decodeURIComponent(part.slice(0, index).trim());
    const value = decodeURIComponent(part.slice(index + 1).trim());

    if (key) acc[key] = value;
    return acc;
  }, {});
}

function createSession(res, user, type = "user") {
  const sessions = readJsonObjectFile(SESSIONS_FILE);
  const sessionId = generateId("session");

  sessions[sessionId] = {
    id: sessionId,
    type,
    email: normalizeEmail(user.email),
    role: user.role || type,
    createdAt: new Date().toISOString()
  };

  writeJsonObjectFile(SESSIONS_FILE, sessions);

  res.cookie("deli_session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 7
  });

  return sessionId;
}

function clearSession(req, res) {
  const cookies = parseCookies(req);
  const sessionId = cookies.deli_session;

  if (sessionId) {
    const sessions = readJsonObjectFile(SESSIONS_FILE);
    delete sessions[sessionId];
    writeJsonObjectFile(SESSIONS_FILE, sessions);
  }

  res.clearCookie("deli_session", {
    httpOnly: true,
    secure: true,
    sameSite: "none"
  });
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const sessionId = cookies.deli_session || bearerToken;
  if (!sessionId) return null;

  const sessions = readJsonObjectFile(SESSIONS_FILE);
  const session = sessions[sessionId];
  if (!session) return null;

  if (session.type === "admin") {
    const admins = readJsonArrayFile(ADMINS_FILE);
    const admin = admins.find((item) => normalizeEmail(item.email) === normalizeEmail(session.email));
    return admin ? { type: "admin", user: admin } : null;
  }

  if (session.role === "restaurant") {
    const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
    const restaurant = restaurants.find((item) => normalizeEmail(item.email) === normalizeEmail(session.email));
    return restaurant ? { type: "user", user: { ...restaurant, role: "restaurant" } } : null;
  }

  const users = readJsonArrayFile(USERS_FILE);
  const user = users.find((item) => normalizeEmail(item.email) === normalizeEmail(session.email));
  return user ? { type: "user", user: { ...user, role: "customer" } } : null;
}

/* ======================================================
   RUTAS DE PRUEBA
====================================================== */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Backend de DeliFoods funcionando"
  });
});

app.get("/session", (req, res) => {
  const session = getSessionUser(req);

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

app.post("/logout", (req, res) => {
  clearSession(req, res);

  res.json({
    ok: true,
    message: "Sesión cerrada"
  });
});

app.get("/users", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);

  res.json({
    ok: true,
    total: users.length,
    users
  });
});

app.get("/users/:email", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);
  const email = normalizeEmail(req.params.email);

  const user = users.find((item) => normalizeEmail(item.email) === email);

  if (!user) {
    return res.status(404).json({
      ok: false,
      message: "Usuario no encontrado"
    });
  }

  res.json({
    ok: true,
    user
  });
});

app.get("/restaurants", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  res.json({
    ok: true,
    total: restaurants.length,
    restaurants
  });
});

app.get("/restaurants/:email", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const email = normalizeEmail(req.params.email);

  const restaurant = restaurants.find(
    (item) => normalizeEmail(item.email) === email
  );

  if (!restaurant) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  res.json({
    ok: true,
    restaurant
  });
});

/* ======================================================
   PLATOS DEL RESTAURANTE
   NUEVO:
   - GET platos por restaurante
   - POST crear plato
   - PUT editar plato
   - DELETE eliminar plato
====================================================== */
app.get("/restaurants/:email/dishes", (req, res) => {
  const email = normalizeEmail(req.params.email);
  const dishes = readJsonArrayFile(DISHES_FILE);

  const restaurantDishes = dishes.filter(
    (dish) => normalizeEmail(dish.restaurantEmail) === email
  );

  res.json({
    ok: true,
    total: restaurantDishes.length,
    dishes: restaurantDishes
  });
});

app.post("/restaurants/:email/dishes", (req, res) => {
  const email = normalizeEmail(req.params.email);
  const dishes = readJsonArrayFile(DISHES_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  const restaurant = restaurants.find(
    (item) => normalizeEmail(item.email) === email
  );

  if (!restaurant) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  const {
    name,
    price,
    description,
    category,
    prepTime,
    emoji,
    available
  } = req.body || {};

  if (!name || !price || !description || !category) {
    return res.status(400).json({
      ok: false,
      message: "Faltan campos obligatorios del plato"
    });
  }

  const newDish = {
    id: generateId("dish"),
    restaurantEmail: email,
    restaurantName: restaurant.name || "Restaurante",
    restaurantAddress: restaurant.address || "",
    name: normalizeText(name),
    price: Number(price || 0),
    description: normalizeText(description),
    category: normalizeText(category),
    prepTime: normalizeText(prepTime),
    emoji: normalizeText(emoji),
    available: available !== false,
    createdAt: new Date().toISOString()
  };

  dishes.push(newDish);
  writeJsonArrayFile(DISHES_FILE, dishes);

  res.status(201).json({
    ok: true,
    message: "Plato creado correctamente",
    dish: newDish
  });
});

app.put("/restaurants/:email/dishes/:dishId", (req, res) => {
  const email = normalizeEmail(req.params.email);
  const dishId = String(req.params.dishId || "").trim();
  const dishes = readJsonArrayFile(DISHES_FILE);

  const index = dishes.findIndex(
    (dish) =>
      String(dish.id).trim() === dishId &&
      normalizeEmail(dish.restaurantEmail) === email
  );

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Plato no encontrado"
    });
  }

  const currentDish = dishes[index];
  const body = req.body || {};

  const updatedDish = {
    ...currentDish,
    name: body.name != null ? normalizeText(body.name) : currentDish.name,
    price: body.price != null ? Number(body.price || 0) : currentDish.price,
    description:
      body.description != null
        ? normalizeText(body.description)
        : currentDish.description,
    category:
      body.category != null ? normalizeText(body.category) : currentDish.category,
    prepTime:
      body.prepTime != null ? normalizeText(body.prepTime) : currentDish.prepTime,
    emoji: body.emoji != null ? normalizeText(body.emoji) : currentDish.emoji,
    available:
      body.available != null ? body.available !== false : currentDish.available,
    updatedAt: new Date().toISOString()
  };

  if (!updatedDish.name || !updatedDish.price || !updatedDish.description || !updatedDish.category) {
    return res.status(400).json({
      ok: false,
      message: "El plato actualizado debe tener nombre, precio, descripción y categoría"
    });
  }

  dishes[index] = updatedDish;
  writeJsonArrayFile(DISHES_FILE, dishes);

  res.json({
    ok: true,
    message: "Plato actualizado correctamente",
    dish: updatedDish
  });
});

app.delete("/restaurants/:email/dishes/:dishId", (req, res) => {
  const email = normalizeEmail(req.params.email);
  const dishId = String(req.params.dishId || "").trim();
  const dishes = readJsonArrayFile(DISHES_FILE);

  const index = dishes.findIndex(
    (dish) =>
      String(dish.id).trim() === dishId &&
      normalizeEmail(dish.restaurantEmail) === email
  );

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Plato no encontrado"
    });
  }

  const deletedDish = dishes[index];
  const updatedDishes = dishes.filter((_, i) => i !== index);

  writeJsonArrayFile(DISHES_FILE, updatedDishes);

  res.json({
    ok: true,
    message: "Plato eliminado correctamente",
    dish: deletedDish
  });
});

/* ======================================================
   REGISTRO CLIENTE
====================================================== */
app.post("/register", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  const {
    fullName,
    address,
    phone,
    email,
    password,
    reference,
    location
  } = req.body;

  if (!fullName || !address || !phone || !email || !password) {
    return res.status(400).json({
      ok: false,
      message: "Faltan campos obligatorios"
    });
  }

  const normalizedEmail = normalizeEmail(email);

  const existsInUsers = users.some(
    (item) => normalizeEmail(item.email) === normalizedEmail
  );

  const existsInRestaurants = restaurants.some(
    (item) => normalizeEmail(item.email) === normalizedEmail
  );

  if (existsInUsers || existsInRestaurants) {
    return res.status(409).json({
      ok: false,
      message: "Ese correo ya está registrado"
    });
  }

  const newUser = {
    id: generateId("user"),
    fullName: normalizeText(fullName),
    address: normalizeText(address),
    phone: normalizeText(phone),
    email: normalizedEmail,
    password: String(password),
    role: "customer",
    reference: normalizeText(reference),
    location: {
      lat: location?.lat || "",
      lng: location?.lng || ""
    },
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJsonArrayFile(USERS_FILE, users);

  res.status(201).json({
    ok: true,
    message: "Usuario registrado correctamente",
    user: newUser
  });
});

/* ======================================================
   REGISTRO RESTAURANTE
====================================================== */
app.post("/register-restaurant", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  const { name, address, phone, email, password } = req.body;

  if (!name || !address || !phone || !email || !password) {
    return res.status(400).json({
      ok: false,
      message: "Faltan campos obligatorios"
    });
  }

  const normalizedEmail = normalizeEmail(email);

  const existsInUsers = users.some(
    (item) => normalizeEmail(item.email) === normalizedEmail
  );

  const existsInRestaurants = restaurants.some(
    (item) => normalizeEmail(item.email) === normalizedEmail
  );

  if (existsInUsers || existsInRestaurants) {
    return res.status(409).json({
      ok: false,
      message: "Ese correo ya está registrado"
    });
  }

  const newRestaurant = {
    id: generateId("restaurant"),
    name: normalizeText(name),
    address: normalizeText(address),
    phone: normalizeText(phone),
    email: normalizedEmail,
    password: String(password),
    role: "restaurant",
    status: "pending",
    commission: 15,
    createdAt: new Date().toISOString()
  };

  restaurants.push(newRestaurant);
  writeJsonArrayFile(RESTAURANTS_FILE, restaurants);

  res.status(201).json({
    ok: true,
    message: "Restaurante registrado correctamente",
    restaurant: newRestaurant
  });
});

/* ======================================================
   LOGIN
====================================================== */
app.post("/login", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);

  const { role, email, password } = req.body;

  if (!role || !email || !password) {
    return res.status(400).json({
      ok: false,
      message: "Faltan credenciales"
    });
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = String(role || "").trim().toLowerCase();

  if (normalizedRole === "restaurant" || normalizedRole === "restaurante") {
    const restaurant = restaurants.find(
      (item) =>
        normalizeEmail(item.email) === normalizedEmail &&
        String(item.password) === String(password)
    );

    if (!restaurant) {
      return res.status(401).json({
        ok: false,
        message: "Datos inválidos para restaurante"
      });
    }

    /*
      VALIDACIÓN ADMINISTRATIVA:
      - Los restaurantes nuevos quedan con status: "pending".
      - Solo pueden entrar al panel si el administrador los aprueba.
      - Los restaurantes antiguos sin status se permiten para no romper datos previos.
    */
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
      message: "Login correcto",
      user: sessionUser
    });
  }

  const user = users.find(
    (item) =>
      normalizeEmail(item.email) === normalizedEmail &&
      String(item.password) === String(password)
  );

  if (!user) {
    return res.status(401).json({
      ok: false,
      message: "Correo o contraseña incorrectos"
    });
  }

  const sessionUser = { ...user, role: "customer" };
  createSession(res, sessionUser, "user");

  res.json({
    ok: true,
    message: "Login correcto",
    user: sessionUser
  });
});

/* ======================================================
   PEDIDOS
====================================================== */
app.post("/orders", (req, res) => {
  const orders = readJsonArrayFile(ORDERS_FILE);

  const {
    id,
    restaurantEmail,
    restaurantName,
    items,
    total,
    customer,
    status,
    paymentMethod,
    notes,
    date,
    time,
    createdAt
  } = req.body;

  if (!restaurantEmail || !Array.isArray(items) || !items.length || !customer) {
    return res.status(400).json({
      ok: false,
      message: "Datos incompletos del pedido"
    });
  }

  const newOrder = {
    id: id || generateId("order"),
    restaurantEmail: normalizeEmail(restaurantEmail),
    restaurantName: restaurantName || "Restaurante",
    items: items.map((item) => ({
      id: item.id || "",
      name: item.name || "Producto",
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      subtotal: Number(item.subtotal || (Number(item.qty || 0) * Number(item.price || 0)))
    })),
    total: Number(total || 0),
    customer: {
      fullName: customer.fullName || customer.name || "",
      phone: customer.phone || "",
      address: customer.address || "",
      email: normalizeEmail(customer.email || "")
    },
    status: status || "pendiente",
    paymentMethod: paymentMethod || "pendiente",
    notes: notes || "",
    date: date || new Date().toLocaleDateString("es-VE"),
    time: time || new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
    createdAt: createdAt || new Date().toISOString()
  };

  orders.unshift(newOrder);
  writeJsonArrayFile(ORDERS_FILE, orders);

  res.status(201).json({
    ok: true,
    message: "Pedido creado correctamente",
    order: newOrder
  });
});

app.get("/orders", (req, res) => {
  const orders = readJsonArrayFile(ORDERS_FILE);
  res.json(orders);
});

app.get("/orders/restaurant/:email", (req, res) => {
  const orders = readJsonArrayFile(ORDERS_FILE);
  const email = normalizeEmail(req.params.email);

  const filtered = orders.filter(
    (order) => normalizeEmail(order.restaurantEmail) === email
  );

  res.json({
    ok: true,
    total: filtered.length,
    orders: filtered
  });
});

app.get("/orders/customer/:email", (req, res) => {
  const orders = readJsonArrayFile(ORDERS_FILE);
  const email = normalizeEmail(req.params.email);

  const filtered = orders.filter(
    (order) => normalizeEmail(order.customer?.email) === email
  );

  res.json({
    ok: true,
    total: filtered.length,
    orders: filtered
  });
});

app.patch("/orders/:id/status", (req, res) => {
  const orders = readJsonArrayFile(ORDERS_FILE);
  const { id } = req.params;
  const { status } = req.body;

  const normalizedStatus = String(status || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  const validStatuses = [
    "pendiente",
    "aceptado",
    "preparando",
    "listo",
    "en_camino",
    "entregado",
    "finalizado"
  ];

  if (!validStatuses.includes(normalizedStatus)) {
    return res.status(400).json({
      ok: false,
      message: "Estado inválido"
    });
  }

  const index = orders.findIndex(
    (order) => String(order.id).trim() === String(id).trim()
  );

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Pedido no encontrado"
    });
  }

  orders[index] = {
    ...orders[index],
    status: normalizedStatus === "finalizado" ? "entregado" : normalizedStatus
  };

  writeJsonArrayFile(ORDERS_FILE, orders);

  res.json({
    ok: true,
    message: "Estado actualizado correctamente",
    order: orders[index]
  });
});


/* ======================================================
   ADMIN LOGIN
====================================================== */
app.post("/admin/login", (req, res) => {
  const admins = readJsonArrayFile(ADMINS_FILE);

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      message: "Faltan credenciales"
    });
  }

  const admin = admins.find(
    (item) =>
      normalizeEmail(item.email) === normalizeEmail(email) &&
      String(item.password) === String(password)
  );

  if (!admin) {
    return res.status(401).json({
      ok: false,
      message: "Credenciales inválidas"
    });
  }

  const sessionToken = createSession(res, { ...admin, role: "admin" }, "admin");

  res.json({
    ok: true,
    message: "Login admin correcto",
    admin,
    sessionToken
  });
});


/* ======================================================
   ADMIN DATOS
====================================================== */
app.get("/admin/datos", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const orders = readJsonArrayFile(ORDERS_FILE);

  res.json({
    ok: true,
    data: {
      users,
      restaurants,
      orders
    }
  });
});


/* ======================================================
   ADMIN RESTAURANTES - CAMBIAR ESTADO
====================================================== */
app.patch("/admin/restaurantes/:id/estado", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const restaurantId = String(req.params.id || "").trim();
  let status = String(req.body?.status || "").trim().toLowerCase();

  // "paused" queda tratado como "blocked" para simplificar el panel.
  if (status === "paused") status = "blocked";

  const validStatuses = ["pending", "approved", "blocked"];

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      message: "Estado inválido"
    });
  }

  const index = restaurants.findIndex((restaurant) => {
    return (
      String(restaurant.id || "").trim() === restaurantId ||
      normalizeEmail(restaurant.email) === normalizeEmail(restaurantId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  restaurants[index] = {
    ...restaurants[index],
    status,
    updatedAt: new Date().toISOString()
  };

  writeJsonArrayFile(RESTAURANTS_FILE, restaurants);

  res.json({
    ok: true,
    message: "Estado del restaurante actualizado correctamente",
    restaurant: restaurants[index]
  });
});




/* ======================================================
   ADMIN USUARIOS - EDITAR USUARIO
   Guarda cambios reales en users.json.
   Si cambia el correo, actualiza también los pedidos del cliente.
====================================================== */
app.patch("/admin/users/:id", (req, res) => {
  const users = readJsonArrayFile(USERS_FILE);
  const orders = readJsonArrayFile(ORDERS_FILE);
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const userId = String(req.params.id || "").trim();

  if (!userId) {
    return res.status(400).json({
      ok: false,
      message: "ID de usuario requerido"
    });
  }

  const index = users.findIndex((user) => {
    return (
      String(user.id || "").trim() === userId ||
      normalizeEmail(user.email) === normalizeEmail(userId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Usuario no encontrado"
    });
  }

  const currentUser = users[index];
  const oldEmail = normalizeEmail(currentUser.email);
  const body = req.body || {};
  const newEmail = normalizeEmail(body.email ?? currentUser.email);

  if (!newEmail) {
    return res.status(400).json({
      ok: false,
      message: "El correo del usuario es obligatorio"
    });
  }

  const emailExistsInUsers = users.some((user, i) => {
    return i !== index && normalizeEmail(user.email) === newEmail;
  });

  const emailExistsInRestaurants = restaurants.some((restaurant) => {
    return normalizeEmail(restaurant.email) === newEmail;
  });

  if (emailExistsInUsers || emailExistsInRestaurants) {
    return res.status(409).json({
      ok: false,
      message: "Ese correo ya está registrado"
    });
  }

  const updatedUser = {
    ...currentUser,
    fullName: body.fullName != null ? normalizeText(body.fullName) : currentUser.fullName,
    name: body.fullName != null ? normalizeText(body.fullName) : currentUser.name,
    email: newEmail,
    phone: body.phone != null ? normalizeText(body.phone) : currentUser.phone,
    address: body.address != null ? normalizeText(body.address) : currentUser.address,
    reference: body.reference != null ? normalizeText(body.reference) : currentUser.reference,
    location: {
      lat: body.location?.lat ?? currentUser.location?.lat ?? "",
      lng: body.location?.lng ?? currentUser.location?.lng ?? ""
    },
    updatedAt: new Date().toISOString()
  };

  if (body.password != null && String(body.password).trim()) {
    updatedUser.password = String(body.password);
  }

  users[index] = updatedUser;

  if (oldEmail && newEmail && oldEmail !== newEmail) {
    orders.forEach((order) => {
      if (normalizeEmail(order.customer?.email) === oldEmail) {
        order.customer = {
          ...(order.customer || {}),
          email: newEmail,
          fullName: updatedUser.fullName || order.customer?.fullName || "",
          phone: updatedUser.phone || order.customer?.phone || "",
          address: updatedUser.address || order.customer?.address || ""
        };
        order.updatedAt = new Date().toISOString();
      }
    });

    writeJsonArrayFile(ORDERS_FILE, orders);
  }

  writeJsonArrayFile(USERS_FILE, users);

  res.json({
    ok: true,
    message: "Usuario actualizado correctamente",
    user: updatedUser
  });
});

/* ======================================================
   ADMIN RESTAURANTES - EDITAR RESTAURANTE
   Guarda cambios reales en restaurants.json.
   Si cambia el correo, migra dishes.json y orders.json.
====================================================== */
app.patch("/admin/restaurantes/:id", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const users = readJsonArrayFile(USERS_FILE);
  const dishes = readJsonArrayFile(DISHES_FILE);
  const orders = readJsonArrayFile(ORDERS_FILE);
  const restaurantId = String(req.params.id || "").trim();

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  const index = restaurants.findIndex((restaurant) => {
    return (
      String(restaurant.id || "").trim() === restaurantId ||
      normalizeEmail(restaurant.email) === normalizeEmail(restaurantId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  const currentRestaurant = restaurants[index];
  const oldEmail = normalizeEmail(currentRestaurant.email);
  const body = req.body || {};
  const newEmail = normalizeEmail(body.email ?? currentRestaurant.email);
  let status = String(body.status ?? currentRestaurant.status ?? "pending").trim().toLowerCase();

  if (status === "paused") status = "blocked";

  const validStatuses = ["pending", "approved", "blocked"];

  if (!newEmail) {
    return res.status(400).json({
      ok: false,
      message: "El correo del restaurante es obligatorio"
    });
  }

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      message: "Estado inválido"
    });
  }

  const emailExistsInRestaurants = restaurants.some((restaurant, i) => {
    return i !== index && normalizeEmail(restaurant.email) === newEmail;
  });

  const emailExistsInUsers = users.some((user) => {
    return normalizeEmail(user.email) === newEmail;
  });

  if (emailExistsInRestaurants || emailExistsInUsers) {
    return res.status(409).json({
      ok: false,
      message: "Ese correo ya está registrado"
    });
  }

  const commissionPercent = Number(
    body.commissionPercent ??
    body.commission ??
    currentRestaurant.commissionPercent ??
    currentRestaurant.commission ??
    15
  );

  if (Number.isNaN(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    return res.status(400).json({
      ok: false,
      message: "La comisión debe estar entre 0 y 100"
    });
  }

  const updatedRestaurant = {
    ...currentRestaurant,
    name: body.name != null ? normalizeText(body.name) : currentRestaurant.name,
    email: newEmail,
    phone: body.phone != null ? normalizeText(body.phone) : currentRestaurant.phone,
    address: body.address != null ? normalizeText(body.address) : currentRestaurant.address,
    category: body.category != null ? normalizeText(body.category) : currentRestaurant.category,
    description: body.description != null ? normalizeText(body.description) : currentRestaurant.description,
    status,
    commission: commissionPercent,
    commissionPercent,
    updatedAt: new Date().toISOString()
  };

  if (body.password != null && String(body.password).trim()) {
    updatedRestaurant.password = String(body.password);
  }

  restaurants[index] = updatedRestaurant;

  dishes.forEach((dish) => {
    if (normalizeEmail(dish.restaurantEmail) === oldEmail || normalizeEmail(dish.restaurantEmail) === newEmail) {
      dish.restaurantEmail = newEmail;
      dish.restaurantName = updatedRestaurant.name || dish.restaurantName;
      dish.restaurantAddress = updatedRestaurant.address || dish.restaurantAddress;
      dish.updatedAt = new Date().toISOString();
    }
  });

  orders.forEach((order) => {
    if (normalizeEmail(order.restaurantEmail) === oldEmail || normalizeEmail(order.restaurantEmail) === newEmail) {
      order.restaurantEmail = newEmail;
      order.restaurantName = updatedRestaurant.name || order.restaurantName;
      order.restaurant = {
        ...(order.restaurant || {}),
        email: newEmail,
        name: updatedRestaurant.name || order.restaurant?.name || order.restaurantName || "Restaurante",
        id: updatedRestaurant.id || order.restaurant?.id || ""
      };
      order.updatedAt = new Date().toISOString();
    }
  });

  writeJsonArrayFile(RESTAURANTS_FILE, restaurants);
  writeJsonArrayFile(DISHES_FILE, dishes);
  writeJsonArrayFile(ORDERS_FILE, orders);

  res.json({
    ok: true,
    message: "Restaurante actualizado correctamente",
    restaurant: updatedRestaurant
  });
});


/* ======================================================
   ADMIN RESTAURANTES - ELIMINAR RESTAURANTE
====================================================== */
app.delete("/admin/restaurantes/:id", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const restaurantId = String(req.params.id || "").trim();

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  const index = restaurants.findIndex((restaurant) => {
    return (
      String(restaurant.id || "").trim() === restaurantId ||
      normalizeEmail(restaurant.email) === normalizeEmail(restaurantId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  const deletedRestaurant = restaurants[index];
  const updatedRestaurants = restaurants.filter((_, i) => i !== index);

  writeJsonArrayFile(RESTAURANTS_FILE, updatedRestaurants);

  res.json({
    ok: true,
    message: "Restaurante eliminado correctamente",
    restaurant: deletedRestaurant
  });
});


/* ======================================================
   ADMIN RESTAURANTES - CAMBIAR COMISIÓN
====================================================== */
app.patch("/admin/restaurantes/:id/comision", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const restaurantId = String(req.params.id || "").trim();
  const commissionPercent = Number(req.body?.commissionPercent ?? req.body?.commission ?? 15);

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  if (Number.isNaN(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    return res.status(400).json({
      ok: false,
      message: "La comisión debe estar entre 0 y 100"
    });
  }

  const index = restaurants.findIndex((restaurant) => {
    return (
      String(restaurant.id || "").trim() === restaurantId ||
      normalizeEmail(restaurant.email) === normalizeEmail(restaurantId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  restaurants[index] = {
    ...restaurants[index],
    commission: commissionPercent,
    commissionPercent,
    updatedAt: new Date().toISOString()
  };

  writeJsonArrayFile(RESTAURANTS_FILE, restaurants);

  res.json({
    ok: true,
    message: "Comisión actualizada correctamente",
    restaurant: restaurants[index]
  });
});



/* ======================================================
   ADMIN RESTAURANTES - RUTAS COMPATIBLES
   Mantienen funcionando nombres anteriores usados por el frontend.
====================================================== */
app.patch("/admin/restaurants/:id/status", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const restaurantId = String(req.params.id || "").trim();
  let status = String(req.body?.status || "").trim().toLowerCase();

  // "paused" queda tratado como "blocked" para simplificar el panel.
  if (status === "paused") status = "blocked";

  const validStatuses = ["pending", "approved", "blocked"];

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      message: "Estado inválido"
    });
  }

  const index = restaurants.findIndex((restaurant) => {
    return (
      String(restaurant.id || "").trim() === restaurantId ||
      normalizeEmail(restaurant.email) === normalizeEmail(restaurantId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  restaurants[index] = {
    ...restaurants[index],
    status,
    updatedAt: new Date().toISOString()
  };

  writeJsonArrayFile(RESTAURANTS_FILE, restaurants);

  res.json({
    ok: true,
    message: "Estado del restaurante actualizado correctamente",
    restaurant: restaurants[index]
  });
});

app.delete("/admin/restaurants/:id", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const restaurantId = String(req.params.id || "").trim();

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  const index = restaurants.findIndex((restaurant) => {
    return (
      String(restaurant.id || "").trim() === restaurantId ||
      normalizeEmail(restaurant.email) === normalizeEmail(restaurantId)
    );
  });

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      message: "Restaurante no encontrado"
    });
  }

  const deletedRestaurant = restaurants[index];
  const updatedRestaurants = restaurants.filter((_, i) => i !== index);

  writeJsonArrayFile(RESTAURANTS_FILE, updatedRestaurants);

  res.json({
    ok: true,
    message: "Restaurante eliminado correctamente",
    restaurant: deletedRestaurant
  });
});


/* ======================================================
   ESTADÍSTICAS PÚBLICAS DEL INDEX
   Calculadas en backend usando orders.json, restaurants.json y dishes.json.
   El frontend solo consume estos endpoints y renderiza resultados.
====================================================== */
function getOrderDate(order) {
  const candidates = [order?.createdAt, order?.updatedAt, order?.date];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function isOrderWithinLast7Days(order) {
  const orderDate = getOrderDate(order);
  if (!orderDate) return false;

  const now = new Date();
  const diff = now.getTime() - orderDate.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return diff >= 0 && diff <= sevenDays;
}

function isCountableOrder(order) {
  const status = String(order?.status || "").trim().toLowerCase();
  const excludedStatuses = [
    "cancelado",
    "cancelada",
    "cancelled",
    "rechazado",
    "rechazada",
    "rejected",
    "anulado",
    "anulada"
  ];

  return !excludedStatuses.includes(status);
}

function getOrdersForStats(orders) {
  const validOrders = Array.isArray(orders) ? orders.filter(isCountableOrder) : [];
  const weeklyOrders = validOrders.filter(isOrderWithinLast7Days);

  if (weeklyOrders.length) {
    return {
      orders: weeklyOrders,
      label: "esta semana",
      period: "weekly"
    };
  }

  return {
    orders: validOrders,
    label: "registrado",
    period: "all_time"
  };
}

function isPublicApprovedRestaurant(restaurant) {
  const status = String(restaurant?.status || "approved").trim().toLowerCase();
  return status === "approved";
}

function getRestaurantPublicStatus(restaurant) {
  const openValue = restaurant?.open;
  const isOpenValue = restaurant?.isOpen;
  const storeStatus = String(restaurant?.storeStatus || restaurant?.availability || "").trim().toLowerCase();

  if (openValue === false || isOpenValue === false) return false;
  if (["closed", "cerrado", "inactive", "inactivo", "disabled", "bloqueado", "blocked"].includes(storeStatus)) {
    return false;
  }

  return true;
}

function formatRestaurantForStats(restaurant, totalOrders) {
  const category = restaurant?.category || restaurant?.type || "Comida";

  return {
    id: restaurant?.id || "",
    name: restaurant?.name || "Restaurante",
    email: normalizeEmail(restaurant?.email),
    type: restaurant?.type || category,
    category,
    rating: restaurant?.rating || "Nuevo",
    delivery: restaurant?.delivery || "A convenir",
    time: restaurant?.time || "20-40 min",
    address: restaurant?.address || "Punto Fijo",
    phone: restaurant?.phone || "",
    open: getRestaurantPublicStatus(restaurant),
    totalOrders
  };
}

function getDishIdentity(item) {
  const id = String(item?.id || item?.dishId || "").trim();
  const name = String(item?.name || item?.dishName || "Plato").trim();
  return { id, name };
}

function findDishReference(dishes, restaurantEmail, item) {
  const { id, name } = getDishIdentity(item);
  const normalizedRestaurantEmail = normalizeEmail(restaurantEmail);
  const normalizedName = String(name || "").trim().toLowerCase();

  return dishes.find((dish) => {
    const sameRestaurant = normalizeEmail(dish.restaurantEmail) === normalizedRestaurantEmail;
    const sameId = id && String(dish.id || "").trim() === id;
    const sameName = normalizedName && String(dish.name || "").trim().toLowerCase() === normalizedName;
    return sameRestaurant && (sameId || sameName);
  }) || null;
}

app.get("/stats/top-restaurants", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const orders = readJsonArrayFile(ORDERS_FILE);
  const rankingData = getOrdersForStats(orders);
  const countsByRestaurant = {};

  rankingData.orders.forEach((order) => {
    const restaurantEmail = normalizeEmail(order.restaurantEmail || order.restaurant?.email || "");
    if (!restaurantEmail) return;
    countsByRestaurant[restaurantEmail] = (countsByRestaurant[restaurantEmail] || 0) + 1;
  });

  const topRestaurants = restaurants
    .filter(isPublicApprovedRestaurant)
    .map((restaurant) => {
      const restaurantEmail = normalizeEmail(restaurant.email);
      const totalOrders = countsByRestaurant[restaurantEmail] || 0;
      return formatRestaurantForStats(restaurant, totalOrders);
    })
    .filter((restaurant) => restaurant.totalOrders > 0)
    .sort((a, b) => b.totalOrders - a.totalOrders)
    .slice(0, 6);

  res.json({
    ok: true,
    label: rankingData.label,
    period: rankingData.period,
    total: topRestaurants.length,
    restaurants: topRestaurants
  });
});

app.get("/stats/top-dishes", (req, res) => {
  const restaurants = readJsonArrayFile(RESTAURANTS_FILE);
  const dishes = readJsonArrayFile(DISHES_FILE);
  const orders = readJsonArrayFile(ORDERS_FILE);
  const rankingData = getOrdersForStats(orders);
  const approvedRestaurantByEmail = {};
  const countsByDish = {};

  restaurants
    .filter(isPublicApprovedRestaurant)
    .forEach((restaurant) => {
      approvedRestaurantByEmail[normalizeEmail(restaurant.email)] = restaurant;
    });

  rankingData.orders.forEach((order) => {
    const restaurantEmail = normalizeEmail(order.restaurantEmail || order.restaurant?.email || "");
    const restaurant = approvedRestaurantByEmail[restaurantEmail];

    if (!restaurant) return;

    const items = Array.isArray(order.items) ? order.items : [];

    items.forEach((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      if (!Number.isFinite(qty) || qty <= 0) return;

      const dishRef = findDishReference(dishes, restaurantEmail, item);
      const identity = getDishIdentity(item);
      const dishId = String(dishRef?.id || identity.id || identity.name).trim();
      const dishName = String(dishRef?.name || identity.name || "Plato").trim();
      const key = `${restaurantEmail}__${dishId || dishName.toLowerCase()}`;
      const price = Number(dishRef?.price ?? item.price ?? item.unitPrice ?? 0);

      if (!countsByDish[key]) {
        countsByDish[key] = {
          dishId,
          dishName,
          dishPrice: Number.isFinite(price) ? price : 0,
          dishCategory: dishRef?.category || item.category || restaurant.category || "Comida",
          dishEmoji: dishRef?.emoji || item.emoji || "🍽️",
          restaurantId: restaurant.id || "",
          restaurantEmail,
          restaurantName: restaurant.name || order.restaurantName || "Restaurante",
          totalQty: 0
        };
      }

      countsByDish[key].totalQty += qty;
    });
  });

  const topDishes = Object.values(countsByDish)
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 6);

  res.json({
    ok: true,
    label: rankingData.label,
    period: rankingData.period,
    total: topDishes.length,
    dishes: topDishes
  });
});



/* ======================================================
   TEST POSTGRESQL / SUPABASE
   - Ruta de prueba para confirmar que Render conecta con Supabase.
   - No modifica datos.
   - No reemplaza todavía JSON.
====================================================== */
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");

    res.json({
      ok: true,
      message: "PostgreSQL conectado correctamente",
      database: "Supabase PostgreSQL",
      time: result.rows[0]
    });
  } catch (error) {
    console.error("Error DB TEST:", error);

    res.status(500).json({
      ok: false,
      message: "Error conectando PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   TEST MIGRACIÓN JSON -> POSTGRESQL
   - Ejecuta la migración manualmente si se necesita repetir.
   - No borra JSON.
   - Evita duplicados por ID.
====================================================== */
app.get("/db-migrate", async (req, res) => {
  try {
    const migrated = await migrateJsonToPostgres();
    const counts = await getDatabaseCounts();

    res.json({
      ok: true,
      message: "Migración JSON -> PostgreSQL ejecutada correctamente",
      migrated,
      counts
    });
  } catch (error) {
    console.error("Error DB MIGRATE:", error);

    res.status(500).json({
      ok: false,
      message: "Error migrando JSON -> PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ESTADO POSTGRESQL
   - Sirve para verificar cuántos registros hay migrados.
====================================================== */
app.get("/db-status", async (req, res) => {
  try {
    const counts = await getDatabaseCounts();

    res.json({
      ok: true,
      message: "Estado PostgreSQL DELI GO",
      counts
    });
  } catch (error) {
    console.error("Error DB STATUS:", error);

    res.status(500).json({
      ok: false,
      message: "Error leyendo estado PostgreSQL",
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log("=================================");
  console.log("🚀 DELI BACKEND ACTIVO");
  console.log("🌐 http://localhost:" + PORT);
  console.log("=================================");
});






































