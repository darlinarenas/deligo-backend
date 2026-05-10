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
    console.log("✅ Bootstrap PostgreSQL completado sin migrar JSON automáticamente");
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


/* ======================================================
   POSTGRESQL - LECTURAS CON RESPALDO JSON
   FASE 3:
   - Estas funciones leen primero desde PostgreSQL.
   - Si PostgreSQL falla, los endpoints usan JSON como respaldo.
   - Mantienen la misma forma de respuesta que ya usa el frontend.
====================================================== */
function mapDbUser(row) {
  return {
    id: row.id || "",
    fullName: row.full_name || row.name || "",
    name: row.name || row.full_name || "",
    address: row.address || "",
    phone: row.phone || "",
    email: normalizeEmail(row.email),
    password: row.password || "",
    role: row.role || "customer",
    status: row.status || "active",
    reference: row.reference || "",
    location: {
      lat: row.latitude || "",
      lng: row.longitude || ""
    },
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

function mapDbRestaurant(row) {
  return {
    id: row.id || "",
    name: row.name || "Restaurante",
    address: row.address || "",
    phone: row.phone || "",
    email: normalizeEmail(row.email),
    password: row.password || "",
    role: row.role || "restaurant",
    category: row.category || "",
    description: row.description || "",
    status: row.status || "pending",
    commission: Number(row.commission ?? row.commission_percent ?? 15),
    commissionPercent: Number(row.commission_percent ?? row.commission ?? 15),
    rating: row.rating || "",
    delivery: row.delivery || "",
    time: row.time || "",
    open: row.open !== false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

function mapDbDish(row) {
  return {
    id: row.id || "",
    restaurantEmail: normalizeEmail(row.restaurant_email),
    restaurantName: row.restaurant_name || "Restaurante",
    restaurantAddress: row.restaurant_address || "",
    name: row.name || "Plato",
    price: Number(row.price || 0),
    description: row.description || "",
    category: row.category || "",
    prepTime: row.prep_time || "",
    emoji: row.emoji || "",
    image: row.image || "",
    available: row.available !== false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

async function getUsersFromPostgres() {
  const result = await pool.query(`
    SELECT *
    FROM users
    ORDER BY created_at DESC NULLS LAST, id ASC
  `);
  return result.rows.map(mapDbUser);
}

async function getUserByEmailFromPostgres(email) {
  const result = await pool.query(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normalizeEmail(email)]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

async function getRestaurantsFromPostgres() {
  const result = await pool.query(`
    SELECT *
    FROM restaurants
    ORDER BY created_at DESC NULLS LAST, name ASC
  `);
  return result.rows.map(mapDbRestaurant);
}

async function getRestaurantByEmailFromPostgres(email) {
  const result = await pool.query(
    `SELECT * FROM restaurants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normalizeEmail(email)]
  );
  return result.rows[0] ? mapDbRestaurant(result.rows[0]) : null;
}

async function getDishesByRestaurantEmailFromPostgres(email) {
  const result = await pool.query(
    `
    SELECT *
    FROM dishes
    WHERE LOWER(restaurant_email) = LOWER($1)
    ORDER BY created_at DESC NULLS LAST, name ASC
    `,
    [normalizeEmail(email)]
  );
  return result.rows.map(mapDbDish);
}


/* ======================================================
   POSTGRESQL - HELPERS REALES PARA PLATOS Y PEDIDOS
   - Mantienen la forma de datos que ya consume el frontend.
   - La fuente principal desde esta versión es PostgreSQL.
   - JSON queda solo como respaldo manual/histórico, no como fuente viva.
====================================================== */
function normalizeOrderStatus(status) {
  const normalizedStatus = String(status || "pendiente")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  return normalizedStatus === "finalizado" ? "entregado" : normalizedStatus;
}

function buildCompatibleOrderFromRow(orderRow, itemRows = []) {
  const items = itemRows.map((item) => ({
    id: item.dish_id || "",
    dishId: item.dish_id || "",
    name: item.name_snapshot || "Producto",
    dishName: item.name_snapshot || "Producto",
    qty: Number(item.quantity || 1),
    quantity: Number(item.quantity || 1),
    price: Number(item.price_snapshot || 0),
    unitPrice: Number(item.price_snapshot || 0),
    subtotal: Number(item.subtotal || 0)
  }));

  return {
    id: orderRow.id || "",
    userId: orderRow.user_id || "",
    restaurantEmail: normalizeEmail(orderRow.restaurant_email),
    restaurantName: orderRow.restaurant_name || "Restaurante",
    restaurant: {
      id: orderRow.restaurant_id || "",
      email: normalizeEmail(orderRow.restaurant_email),
      name: orderRow.restaurant_name || "Restaurante"
    },
    items,
    total: Number(orderRow.total || 0),
    customer: {
      fullName: orderRow.customer_name || "",
      name: orderRow.customer_name || "",
      phone: orderRow.customer_phone || "",
      address: orderRow.customer_address || orderRow.delivery_address || "",
      email: normalizeEmail(orderRow.customer_email || ""),
      reference: orderRow.delivery_reference || "",
      location: {
        lat: orderRow.latitude || "",
        lng: orderRow.longitude || ""
      }
    },
    customerEmail: normalizeEmail(orderRow.customer_email || ""),
    customerName: orderRow.customer_name || "",
    status: orderRow.status || "pendiente",
    paymentMethod: orderRow.payment_method || "pendiente",
    paymentStatus: orderRow.payment_status || "pendiente",
    notes: orderRow.notes || "",
    deliveryAddress: orderRow.delivery_address || orderRow.customer_address || "",
    deliveryReference: orderRow.delivery_reference || "",
    latitude: orderRow.latitude || "",
    longitude: orderRow.longitude || "",
    date: orderRow.date_text || (orderRow.created_at ? new Date(orderRow.created_at).toLocaleDateString("es-VE") : ""),
    time: orderRow.time_text || (orderRow.created_at ? new Date(orderRow.created_at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) : ""),
    createdAt: orderRow.created_at ? new Date(orderRow.created_at).toISOString() : "",
    updatedAt: orderRow.updated_at ? new Date(orderRow.updated_at).toISOString() : ""
  };
}

async function getOrdersFromPostgres({ restaurantEmail = null, customerEmail = null } = {}) {
  const values = [];
  const where = [];

  if (restaurantEmail) {
    values.push(normalizeEmail(restaurantEmail));
    where.push(`LOWER(restaurant_email) = LOWER($${values.length})`);
  }

  if (customerEmail) {
    values.push(normalizeEmail(customerEmail));
    where.push(`LOWER(customer_email) = LOWER($${values.length})`);
  }

  const orderResult = await pool.query(
    `
    SELECT *
    FROM orders
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC NULLS LAST, id DESC
    `,
    values
  );

  const orders = orderResult.rows;
  if (!orders.length) return [];

  const orderIds = orders.map((order) => order.id);
  const itemsResult = await pool.query(
    `
    SELECT *
    FROM order_items
    WHERE order_id = ANY($1::text[])
    ORDER BY created_at ASC NULLS LAST, id ASC
    `,
    [orderIds]
  );

  const itemsByOrderId = itemsResult.rows.reduce((acc, item) => {
    if (!acc[item.order_id]) acc[item.order_id] = [];
    acc[item.order_id].push(item);
    return acc;
  }, {});

  return orders.map((order) => buildCompatibleOrderFromRow(order, itemsByOrderId[order.id] || []));
}

async function getOrderByIdFromPostgres(orderId) {
  const orderResult = await pool.query(
    `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
    [String(orderId || "").trim()]
  );

  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC NULLS LAST, id ASC`,
    [order.id]
  );

  return buildCompatibleOrderFromRow(order, itemsResult.rows);
}

async function createDishInPostgres(restaurant, body) {
  const id = generateId("dish");
  const result = await pool.query(
    `
    INSERT INTO dishes (
      id, restaurant_id, restaurant_email, restaurant_name, restaurant_address,
      name, description, price, category, prep_time, emoji, image, available,
      created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
    RETURNING *
    `,
    [
      id,
      restaurant.id || null,
      normalizeEmail(restaurant.email),
      restaurant.name || "Restaurante",
      restaurant.address || "",
      normalizeText(body.name),
      normalizeText(body.description),
      toNumberValue(body.price, 0),
      normalizeText(body.category),
      normalizeText(body.prepTime),
      normalizeText(body.emoji),
      normalizeText(body.image),
      body.available !== false
    ]
  );

  return mapDbDish(result.rows[0]);
}

async function updateDishInPostgres(email, dishId, body) {
  const currentResult = await pool.query(
    `SELECT * FROM dishes WHERE id = $1 AND LOWER(restaurant_email) = LOWER($2) LIMIT 1`,
    [String(dishId || "").trim(), normalizeEmail(email)]
  );

  const current = currentResult.rows[0];
  if (!current) return null;

  const finalName = body.name != null ? normalizeText(body.name) : current.name;
  const finalPrice = body.price != null ? toNumberValue(body.price, 0) : Number(current.price || 0);
  const finalDescription = body.description != null ? normalizeText(body.description) : (current.description || "");
  const finalCategory = body.category != null ? normalizeText(body.category) : (current.category || "");

  if (!finalName || !finalDescription || !finalCategory || finalPrice <= 0) {
    const error = new Error("El plato actualizado debe tener nombre, precio, descripción y categoría");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `
    UPDATE dishes
    SET
      name = $1,
      price = $2,
      description = $3,
      category = $4,
      prep_time = $5,
      emoji = $6,
      image = $7,
      available = $8,
      updated_at = NOW()
    WHERE id = $9 AND LOWER(restaurant_email) = LOWER($10)
    RETURNING *
    `,
    [
      finalName,
      finalPrice,
      finalDescription,
      finalCategory,
      body.prepTime != null ? normalizeText(body.prepTime) : (current.prep_time || ""),
      body.emoji != null ? normalizeText(body.emoji) : (current.emoji || ""),
      body.image != null ? normalizeText(body.image) : (current.image || ""),
      body.available != null ? body.available !== false : current.available !== false,
      String(dishId || "").trim(),
      normalizeEmail(email)
    ]
  );

  return mapDbDish(result.rows[0]);
}

async function deleteDishFromPostgres(email, dishId) {
  const result = await pool.query(
    `
    DELETE FROM dishes
    WHERE id = $1 AND LOWER(restaurant_email) = LOWER($2)
    RETURNING *
    `,
    [String(dishId || "").trim(), normalizeEmail(email)]
  );

  return result.rows[0] ? mapDbDish(result.rows[0]) : null;
}

async function createOrderInPostgres(body) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const restaurantEmail = normalizeEmail(body.restaurantEmail || body.restaurant?.email || "");
    const items = Array.isArray(body.items) ? body.items : [];
    const customer = body.customer || {};

    if (!restaurantEmail || !items.length || !customer) {
      const error = new Error("Datos incompletos del pedido");
      error.statusCode = 400;
      throw error;
    }

    const restaurantResult = await client.query(
      `SELECT * FROM restaurants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [restaurantEmail]
    );

    const restaurant = restaurantResult.rows[0];
    if (!restaurant) {
      const error = new Error("Restaurante no encontrado");
      error.statusCode = 404;
      throw error;
    }

    const customerEmail = normalizeEmail(customer.email || body.customerEmail || body.userEmail || "");
    let userId = body.userId || null;

    if (customerEmail && !userId) {
      const userResult = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [customerEmail]
      );
      userId = userResult.rows[0]?.id || null;
    }

    const id = String(body.id || generateId("order")).trim();
    const normalizedItems = items.map((item) => {
      const quantity = toNumberValue(item.qty ?? item.quantity, 1);
      const price = toNumberValue(item.price ?? item.unitPrice, 0);
      return {
        id: String(item.id || item.dishId || "").trim(),
        name: normalizeText(item.name || item.dishName || "Producto"),
        qty: quantity,
        price,
        subtotal: toNumberValue(item.subtotal, quantity * price)
      };
    });

    const calculatedTotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const total = toNumberValue(body.total, calculatedTotal);
    const createdAt = toDateValue(body.createdAt) || new Date().toISOString();

    await client.query(
      `
      INSERT INTO orders (
        id, user_id, customer_email, customer_name, customer_phone, customer_address,
        restaurant_id, restaurant_email, restaurant_name, status, total,
        payment_method, payment_status, notes, delivery_address, delivery_reference,
        latitude, longitude, date_text, time_text, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
      RETURNING *
      `,
      [
        id,
        userId,
        customerEmail || null,
        normalizeText(customer.fullName || customer.name || body.customerName || ""),
        normalizeText(customer.phone || body.customerPhone || ""),
        normalizeText(customer.address || body.customerAddress || ""),
        restaurant.id || null,
        restaurantEmail,
        body.restaurantName || restaurant.name || "Restaurante",
        normalizeOrderStatus(body.status || "pendiente"),
        total,
        normalizeText(body.paymentMethod || "pendiente"),
        normalizeText(body.paymentStatus || "pendiente"),
        normalizeText(body.notes),
        normalizeText(body.deliveryAddress || customer.address || ""),
        normalizeText(body.deliveryReference || customer.reference || ""),
        normalizeText(body.latitude || body.location?.lat || customer.location?.lat || ""),
        normalizeText(body.longitude || body.location?.lng || customer.location?.lng || ""),
        normalizeText(body.date || new Date(createdAt).toLocaleDateString("es-VE")),
        normalizeText(body.time || new Date(createdAt).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })),
        createdAt
      ]
    );

    for (let index = 0; index < normalizedItems.length; index += 1) {
      const item = normalizedItems[index];
      await client.query(
        `
        INSERT INTO order_items (
          id, order_id, dish_id, name_snapshot, price_snapshot,
          quantity, subtotal, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        `,
        [
          `${id}_item_${index}_${item.id || "sin_id"}`,
          id,
          item.id || null,
          item.name,
          item.price,
          item.qty,
          item.subtotal
        ]
      );
    }

    await client.query("COMMIT");
    return await getOrderByIdFromPostgres(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

async function getSessionUser(req) {
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
    const result = await pool.query(
      `SELECT * FROM admins WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizeEmail(session.email)]
    );

    const admin = result.rows[0];
    return admin
      ? {
          type: "admin",
          user: {
            id: admin.id || "",
            name: admin.name || "Administrador",
            email: normalizeEmail(admin.email),
            role: admin.role || "admin",
            status: admin.status || "active"
          }
        }
      : null;
  }

  if (session.role === "restaurant") {
    const restaurant = await getRestaurantByEmailFromPostgres(session.email);
    return restaurant ? { type: "user", user: { ...restaurant, role: "restaurant" } } : null;
  }

  const user = await getUserByEmailFromPostgres(session.email);
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

app.get("/session", async (req, res) => {
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

app.post("/logout", (req, res) => {
  clearSession(req, res);

  res.json({
    ok: true,
    message: "Sesión cerrada"
  });
});

app.get("/users", async (req, res) => {
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

app.get("/users/:email", async (req, res) => {
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

app.get("/restaurants", async (req, res) => {
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

app.get("/restaurants/:email", async (req, res) => {
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

/* ======================================================
   PLATOS DEL RESTAURANTE
   NUEVO:
   - GET platos por restaurante
   - POST crear plato
   - PUT editar plato
   - DELETE eliminar plato
====================================================== */
app.get("/restaurants/:email/dishes", async (req, res) => {
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
    console.error("Error leyendo platos desde PostgreSQL, usando JSON:", error.message);

    const dishes = readJsonArrayFile(DISHES_FILE);
    const restaurantDishes = dishes.filter(
      (dish) => normalizeEmail(dish.restaurantEmail) === email
    );

    return res.json({
      ok: true,
      source: "json_fallback",
      total: restaurantDishes.length,
      dishes: restaurantDishes
    });
  }
});

app.post("/restaurants/:email/dishes", async (req, res) => {
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

app.put("/restaurants/:email/dishes/:dishId", async (req, res) => {
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

app.delete("/restaurants/:email/dishes/:dishId", async (req, res) => {
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

/* ======================================================
   REGISTRO CLIENTE - SOLO POSTGRESQL
====================================================== */
app.post("/register", async (req, res) => {
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
   REGISTRO RESTAURANTE - SOLO POSTGRESQL
====================================================== */
app.post("/register-restaurant", async (req, res) => {
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
   LOGIN - SOLO POSTGRESQL
====================================================== */
app.post("/login", async (req, res) => {
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

/* ======================================================
   PEDIDOS - POSTGRESQL REAL
   - Crea pedidos en orders + order_items.
   - Lee pedidos desde PostgreSQL.
   - Actualiza estados en PostgreSQL.
   - Mantiene el mismo formato que ya consume el frontend.
====================================================== */
app.post("/orders", async (req, res) => {
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

app.get("/orders", async (req, res) => {
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

app.get("/orders/restaurant/:email", async (req, res) => {
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

app.get("/orders/customer/:email", async (req, res) => {
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

app.patch("/orders/:id/status", async (req, res) => {
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


/* ======================================================
   ADMIN LOGIN - SOLO POSTGRESQL
====================================================== */
app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      message: "Faltan credenciales"
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM admins
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [normalizeEmail(email)]
    );

    const adminRow = result.rows[0];

    if (!adminRow || String(adminRow.password) !== String(password)) {
      return res.status(401).json({
        ok: false,
        message: "Credenciales inválidas"
      });
    }

    const admin = {
      id: adminRow.id || "",
      name: adminRow.name || "Administrador",
      email: normalizeEmail(adminRow.email),
      password: adminRow.password || "",
      role: adminRow.role || "admin",
      status: adminRow.status || "active"
    };

    const sessionToken = createSession(res, { ...admin, role: "admin" }, "admin");

    return res.json({
      ok: true,
      source: "postgres",
      message: "Login admin correcto",
      admin,
      sessionToken
    });
  } catch (error) {
    console.error("Error login admin PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error login admin PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN DATOS - TODO DESDE POSTGRESQL
   - Usuarios, restaurantes y pedidos ya salen desde PostgreSQL.
   - Mantiene la misma estructura data.users/data.restaurants/data.orders.
====================================================== */
app.get("/admin/datos", async (req, res) => {
  try {
    const users = await getUsersFromPostgres();
    const restaurants = await getRestaurantsFromPostgres();
    const orders = await getOrdersFromPostgres();

    return res.json({
      ok: true,
      source: "postgres",
      data: {
        users,
        restaurants,
        orders
      }
    });
  } catch (error) {
    console.error("Error leyendo datos admin desde PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error leyendo datos admin desde PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN RESTAURANTES - CAMBIAR ESTADO - SOLO POSTGRESQL
====================================================== */
app.patch("/admin/restaurantes/:id/estado", async (req, res) => {
  const restaurantId = String(req.params.id || "").trim();
  let status = String(req.body?.status || "").trim().toLowerCase();

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

  try {
    const result = await pool.query(
      `
      UPDATE restaurants
      SET status = $1, updated_at = NOW()
      WHERE id = $2 OR LOWER(email) = LOWER($2)
      RETURNING *
      `,
      [status, restaurantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        message: "Restaurante no encontrado"
      });
    }

    return res.json({
      ok: true,
      source: "postgres",
      message: "Estado del restaurante actualizado correctamente",
      restaurant: mapDbRestaurant(result.rows[0])
    });
  } catch (error) {
    console.error("Error actualizando estado en PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error actualizando estado en PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN USUARIOS - EDITAR USUARIO - SOLO POSTGRESQL
====================================================== */
app.patch("/admin/users/:id", async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const body = req.body || {};
  const newEmail = normalizeEmail(body.email || "");

  if (!userId) {
    return res.status(400).json({
      ok: false,
      message: "ID de usuario requerido"
    });
  }

  try {
    const currentResult = await pool.query(
      `SELECT * FROM users WHERE id = $1 OR LOWER(email) = LOWER($1) LIMIT 1`,
      [userId]
    );

    const current = currentResult.rows[0];

    if (!current) {
      return res.status(404).json({
        ok: false,
        message: "Usuario no encontrado"
      });
    }

    const finalEmail = newEmail || normalizeEmail(current.email);

    const exists = await pool.query(
      `
      SELECT email FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2
      UNION
      SELECT email FROM restaurants WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [finalEmail, current.id]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        ok: false,
        message: "Ese correo ya está registrado"
      });
    }

    const updated = await pool.query(
      `
      UPDATE users
      SET
        full_name = $1,
        name = $2,
        email = $3,
        phone = $4,
        address = $5,
        reference = $6,
        latitude = $7,
        longitude = $8,
        password = $9,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
      `,
      [
        body.fullName != null ? normalizeText(body.fullName) : (current.full_name || current.name || ""),
        body.fullName != null ? normalizeText(body.fullName) : (current.name || current.full_name || ""),
        finalEmail,
        body.phone != null ? normalizeText(body.phone) : (current.phone || ""),
        body.address != null ? normalizeText(body.address) : (current.address || ""),
        body.reference != null ? normalizeText(body.reference) : (current.reference || ""),
        body.location?.lat ?? current.latitude ?? "",
        body.location?.lng ?? current.longitude ?? "",
        body.password != null && String(body.password).trim() ? String(body.password) : (current.password || ""),
        current.id
      ]
    );

    return res.json({
      ok: true,
      source: "postgres",
      message: "Usuario actualizado correctamente",
      user: mapDbUser(updated.rows[0])
    });
  } catch (error) {
    console.error("Error actualizando usuario en PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error actualizando usuario en PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN RESTAURANTES - EDITAR RESTAURANTE - SOLO POSTGRESQL
====================================================== */
app.patch("/admin/restaurantes/:id", async (req, res) => {
  const restaurantId = String(req.params.id || "").trim();
  const body = req.body || {};

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  try {
    const currentResult = await pool.query(
      `SELECT * FROM restaurants WHERE id = $1 OR LOWER(email) = LOWER($1) LIMIT 1`,
      [restaurantId]
    );

    const current = currentResult.rows[0];

    if (!current) {
      return res.status(404).json({
        ok: false,
        message: "Restaurante no encontrado"
      });
    }

    const finalEmail = normalizeEmail(body.email ?? current.email);
    let status = String(body.status ?? current.status ?? "pending").trim().toLowerCase();
    if (status === "paused") status = "blocked";

    const validStatuses = ["pending", "approved", "blocked"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: "Estado inválido"
      });
    }

    const exists = await pool.query(
      `
      SELECT email FROM restaurants WHERE LOWER(email) = LOWER($1) AND id <> $2
      UNION
      SELECT email FROM users WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [finalEmail, current.id]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        ok: false,
        message: "Ese correo ya está registrado"
      });
    }

    const commissionPercent = Number(
      body.commissionPercent ??
      body.commission ??
      current.commission_percent ??
      current.commission ??
      15
    );

    if (Number.isNaN(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      return res.status(400).json({
        ok: false,
        message: "La comisión debe estar entre 0 y 100"
      });
    }

    const updated = await pool.query(
      `
      UPDATE restaurants
      SET
        name = $1,
        email = $2,
        phone = $3,
        address = $4,
        category = $5,
        description = $6,
        status = $7,
        commission = $8,
        commission_percent = $8,
        password = $9,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
      `,
      [
        body.name != null ? normalizeText(body.name) : current.name,
        finalEmail,
        body.phone != null ? normalizeText(body.phone) : (current.phone || ""),
        body.address != null ? normalizeText(body.address) : (current.address || ""),
        body.category != null ? normalizeText(body.category) : (current.category || ""),
        body.description != null ? normalizeText(body.description) : (current.description || ""),
        status,
        commissionPercent,
        body.password != null && String(body.password).trim() ? String(body.password) : (current.password || ""),
        current.id
      ]
    );

    return res.json({
      ok: true,
      source: "postgres",
      message: "Restaurante actualizado correctamente",
      restaurant: mapDbRestaurant(updated.rows[0])
    });
  } catch (error) {
    console.error("Error actualizando restaurante en PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error actualizando restaurante en PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN RESTAURANTES - ELIMINAR RESTAURANTE - SOLO POSTGRESQL
====================================================== */
app.delete("/admin/restaurantes/:id", async (req, res) => {
  const restaurantId = String(req.params.id || "").trim();

  if (!restaurantId) {
    return res.status(400).json({
      ok: false,
      message: "ID de restaurante requerido"
    });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM restaurants
      WHERE id = $1 OR LOWER(email) = LOWER($1)
      RETURNING *
      `,
      [restaurantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        message: "Restaurante no encontrado"
      });
    }

    return res.json({
      ok: true,
      source: "postgres",
      message: "Restaurante eliminado correctamente",
      restaurant: mapDbRestaurant(result.rows[0])
    });
  } catch (error) {
    console.error("Error eliminando restaurante en PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error eliminando restaurante en PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN RESTAURANTES - CAMBIAR COMISIÓN - SOLO POSTGRESQL
====================================================== */
app.patch("/admin/restaurantes/:id/comision", async (req, res) => {
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

  try {
    const result = await pool.query(
      `
      UPDATE restaurants
      SET commission = $1, commission_percent = $1, updated_at = NOW()
      WHERE id = $2 OR LOWER(email) = LOWER($2)
      RETURNING *
      `,
      [commissionPercent, restaurantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        message: "Restaurante no encontrado"
      });
    }

    return res.json({
      ok: true,
      source: "postgres",
      message: "Comisión actualizada correctamente",
      restaurant: mapDbRestaurant(result.rows[0])
    });
  } catch (error) {
    console.error("Error actualizando comisión en PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error actualizando comisión en PostgreSQL",
      error: error.message
    });
  }
});

/* ======================================================
   ADMIN RESTAURANTES - RUTAS COMPATIBLES
====================================================== */
app.patch("/admin/restaurants/:id/status", async (req, res) => {
  const restaurantId = String(req.params.id || "").trim();
  let status = String(req.body?.status || "").trim().toLowerCase();

  if (status === "paused") status = "blocked";

  const validStatuses = ["pending", "approved", "blocked"];

  if (!restaurantId) {
    return res.status(400).json({ ok: false, message: "ID de restaurante requerido" });
  }

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ ok: false, message: "Estado inválido" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE restaurants
      SET status = $1, updated_at = NOW()
      WHERE id = $2 OR LOWER(email) = LOWER($2)
      RETURNING *
      `,
      [status, restaurantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ ok: false, message: "Restaurante no encontrado" });
    }

    return res.json({
      ok: true,
      source: "postgres",
      message: "Estado del restaurante actualizado correctamente",
      restaurant: mapDbRestaurant(result.rows[0])
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Error actualizando estado en PostgreSQL",
      error: error.message
    });
  }
});

app.delete("/admin/restaurants/:id", async (req, res) => {
  const restaurantId = String(req.params.id || "").trim();

  if (!restaurantId) {
    return res.status(400).json({ ok: false, message: "ID de restaurante requerido" });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM restaurants
      WHERE id = $1 OR LOWER(email) = LOWER($1)
      RETURNING *
      `,
      [restaurantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ ok: false, message: "Restaurante no encontrado" });
    }

    return res.json({
      ok: true,
      source: "postgres",
      message: "Restaurante eliminado correctamente",
      restaurant: mapDbRestaurant(result.rows[0])
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Error eliminando restaurante en PostgreSQL",
      error: error.message
    });
  }
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

app.get("/stats/top-restaurants", async (req, res) => {
  try {
    const restaurants = await getRestaurantsFromPostgres();
    const orders = await getOrdersFromPostgres();
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

    return res.json({
      ok: true,
      source: "postgres",
      label: rankingData.label,
      period: rankingData.period,
      total: topRestaurants.length,
      restaurants: topRestaurants
    });
  } catch (error) {
    console.error("Error leyendo ranking de restaurantes desde PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error leyendo ranking de restaurantes desde PostgreSQL",
      error: error.message
    });
  }
});

app.get("/stats/top-dishes", async (req, res) => {
  try {
    const restaurants = await getRestaurantsFromPostgres();
    const orders = await getOrdersFromPostgres();
    const dishRows = await pool.query(`SELECT * FROM dishes ORDER BY created_at DESC NULLS LAST, name ASC`);
    const dishes = dishRows.rows.map(mapDbDish);
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

    return res.json({
      ok: true,
      source: "postgres",
      label: rankingData.label,
      period: rankingData.period,
      total: topDishes.length,
      dishes: topDishes
    });
  } catch (error) {
    console.error("Error leyendo ranking de platos desde PostgreSQL:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error leyendo ranking de platos desde PostgreSQL",
      error: error.message
    });
  }
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









































