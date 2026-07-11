console.log("SERVER NUEVO CON ADMIN ACTIVO");

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const { pool } = require("./db/postgres");
const {
  normalizeEmail,
  normalizeText,
  generateId,
  toNullableText,
  toNumberValue,
  toBooleanValue,
  toDateValue
} = require("./utils/normalizadores");
const crearRutasRestaurantes = require("./routes/restaurantes.routes");
const crearRutasUsuarios = require("./routes/usuarios.routes");
const crearRutasAuth = require("./routes/auth.routes");
const crearRutasPedidos = require("./routes/pedidos.routes");
const crearRutasPlatos = require("./routes/platos.routes");
const crearRutasAdmin = require("./routes/admin.routes");
const crearRutasDirecciones = require("./routes/direcciones.routes");
const crearRutasServices = require("./routes/services.routes");

const app = express();
const PORT = process.env.PORT || 3001;

/* ======================================================
   POSTGRESQL / SUPABASE
   - La conexión fue separada a db/postgres.js.
   - server.js mantiene las mismas rutas y la misma lógica.
   - Solo usamos el pool exportado para seguir trabajando con PostgreSQL.
====================================================== */

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
      CREATE TABLE IF NOT EXISTS delivery_invites (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        invite_token TEXT UNIQUE NOT NULL,
        sender_name TEXT,
        sender_email TEXT,
        recipient_name TEXT NOT NULL,
        recipient_phone TEXT,
        invite_message TEXT,
        invite_status TEXT DEFAULT 'pending_location',
        share_url TEXT,
        recipient_address TEXT,
        recipient_reference TEXT,
        recipient_latitude TEXT,
        recipient_longitude TEXT,
        confirmed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS delivery_saved_guests (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        alias TEXT NOT NULL,
        recipient_name TEXT,
        recipient_phone TEXT,
        address TEXT,
        reference TEXT,
        latitude TEXT,
        longitude TEXT,
        source_invite_id TEXT,
        last_invite_id TEXT,
        usage_count NUMERIC DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE delivery_invites
      ADD COLUMN IF NOT EXISTS save_guest_on_confirm BOOLEAN DEFAULT FALSE;
    `);

    await pool.query(`
      ALTER TABLE delivery_invites
      ADD COLUMN IF NOT EXISTS guest_alias TEXT;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_delivery_saved_guests_owner
      ON delivery_saved_guests (LOWER(owner_email));
    `);


    await pool.query(`
      CREATE TABLE IF NOT EXISTS invitaciones_pendientes (
        id TEXT PRIMARY KEY,
        invite_token TEXT UNIQUE NOT NULL,
        sender_email TEXT NOT NULL,
        sender_name TEXT,
        recipient_name TEXT NOT NULL,
        recipient_phone TEXT,
        invite_message TEXT,
        restaurant_email TEXT NOT NULL,
        restaurant_name TEXT,
        cart_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
        order_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        subtotal NUMERIC DEFAULT 0,
        total NUMERIC DEFAULT 0,
        invite_status TEXT DEFAULT 'pendiente',
        share_url TEXT,
        save_guest_on_confirm BOOLEAN DEFAULT FALSE,
        guest_alias TEXT,
        recipient_address TEXT,
        recipient_reference TEXT,
        recipient_latitude TEXT,
        recipient_longitude TEXT,
        order_id TEXT,
        confirmed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_invitaciones_pendientes_token
      ON invitaciones_pendientes (invite_token);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_invitaciones_pendientes_sender
      ON invitaciones_pendientes (LOWER(sender_email));
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
  "https://bhuz.vercel.app",
  "https://deli-go-frontend-gamma.vercel.app",
  "https://deli-go-frontend-wheat.vercel.app",
  "https://deli-go.netlify.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/.*\.vercel\.app$/i,
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
        toNullableText(customer.address || body.customerAddress || ""),
        restaurant.id || null,
        restaurantEmail,
        body.restaurantName || restaurant.name || "Restaurante",
        normalizeOrderStatus(body.status || "pendiente"),
        total,
        normalizeText(body.paymentMethod || "pendiente"),
        normalizeText(body.paymentStatus || "pendiente"),
        normalizeText(body.notes),
        toNullableText(body.deliveryAddress || customer.address || ""),
        toNullableText(body.deliveryReference || customer.reference || ""),
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


/* ======================================================
   RUTAS AUTH MODULARIZADAS
   - GET /session
   - POST /logout
   - POST /register
   - POST /register-restaurant
   - POST /login
   - La lógica fue movida a routes/auth.routes.js
====================================================== */
app.use("/", crearRutasAuth({
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
}));

/* ======================================================
   RUTAS DIRECCIONES DE USUARIO - BHUZ
   - GET /users/:email/addresses
   - POST /users/:email/addresses
   - PUT /users/:email/addresses/:addressId/default
   - DELETE /users/:email/addresses/:addressId
   - Dirección escrita + referencia + GPS obligatorio.
====================================================== */
app.use("/users/:email/addresses", crearRutasDirecciones({
  pool,
  normalizeEmail,
  normalizeText,
  generateId
}));

/* ======================================================
   RUTAS USUARIOS MODULARIZADAS
   - GET /users
   - GET /users/:email
   - La lógica fue movida a routes/usuarios.routes.js
   - No cambia login, registro, admin ni pedidos.
====================================================== */
app.use("/users", crearRutasUsuarios({
  normalizeEmail,
  getUsersFromPostgres,
  getUserByEmailFromPostgres
}));

/* ======================================================
   RUTAS RESTAURANTES MODULARIZADAS
   - GET /restaurants
   - GET /restaurants/:email
   - La lógica fue movida a routes/restaurantes.routes.js
   - Las rutas de platos se mantienen abajo por ahora.
====================================================== */
app.use("/restaurants", crearRutasRestaurantes({
  normalizeEmail,
  getRestaurantsFromPostgres,
  getRestaurantByEmailFromPostgres
}));


/* ======================================================
   RUTAS PLATOS MODULARIZADAS
   - GET /restaurants/:email/dishes
   - POST /restaurants/:email/dishes
   - PUT /restaurants/:email/dishes/:dishId
   - DELETE /restaurants/:email/dishes/:dishId
   - La lógica fue movida a routes/platos.routes.js
====================================================== */
app.use("/restaurants/:email/dishes", crearRutasPlatos({
  normalizeEmail,
  getDishesByRestaurantEmailFromPostgres,
  getRestaurantByEmailFromPostgres,
  createDishInPostgres,
  updateDishInPostgres,
  deleteDishFromPostgres
}));


/* ======================================================
   BHUZ - INVITAR COMIDA
   - Link público para que el receptor comparta GPS.
   - No reemplaza el pedido normal.
   - PostgreSQL es la fuente real.
====================================================== */

function generateInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeFrontendBaseUrl(value, req) {
  const fallbackOrigin = req.get("origin") || "";
  const raw = String(value || fallbackOrigin || "").trim();

  if (!raw) return "";

  try {
    const url = new URL(raw);
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    return raw.endsWith("/") ? raw : `${raw}/`;
  }
}

function buildInviteUrl(baseUrl, token) {
  const cleanBase = String(baseUrl || "").trim();

  if (!cleanBase) {
    return `/invite.html?token=${encodeURIComponent(token)}`;
  }

  return `${cleanBase}invite.html?token=${encodeURIComponent(token)}`;
}

function mapDbDeliveryInvite(row) {
  if (!row) return null;

  return {
    id: row.id || "",
    orderId: row.order_id || "",
    token: row.invite_token || "",
    senderName: row.sender_name || "",
    senderEmail: normalizeEmail(row.sender_email || ""),
    recipientName: row.recipient_name || "",
    recipientPhone: row.recipient_phone || "",
    message: row.invite_message || "",
    saveGuestOnConfirm: row.save_guest_on_confirm === true,
    guestAlias: row.guest_alias || "",
    status: row.invite_status || "pending_location",
    shareUrl: row.share_url || "",
    recipientAddress: row.recipient_address || "",
    recipientReference: row.recipient_reference || "",
    recipientLatitude: row.recipient_latitude || "",
    recipientLongitude: row.recipient_longitude || "",
    confirmedAt: row.confirmed_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    location: {
      lat: row.recipient_latitude || "",
      lng: row.recipient_longitude || ""
    }
  };
}



function mapDbInvitacionPendiente(row) {
  if (!row) return null;

  return {
    id: row.id || "",
    token: row.invite_token || "",
    senderEmail: normalizeEmail(row.sender_email || ""),
    senderName: row.sender_name || "",
    recipientName: row.recipient_name || "",
    recipientPhone: row.recipient_phone || "",
    message: row.invite_message || "",
    restaurantEmail: normalizeEmail(row.restaurant_email || ""),
    restaurantName: row.restaurant_name || "Restaurante",
    cart: row.cart_payload || [],
    orderPayload: row.order_payload || {},
    subtotal: Number(row.subtotal || 0),
    total: Number(row.total || 0),
    status: row.invite_status || "pendiente",
    shareUrl: row.share_url || "",
    saveGuestOnConfirm: row.save_guest_on_confirm === true,
    guestAlias: row.guest_alias || "",
    recipientAddress: row.recipient_address || "",
    recipientReference: row.recipient_reference || "",
    recipientLatitude: row.recipient_latitude || "",
    recipientLongitude: row.recipient_longitude || "",
    orderId: row.order_id || "",
    confirmedAt: row.confirmed_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    location: {
      lat: row.recipient_latitude || "",
      lng: row.recipient_longitude || ""
    }
  };
}

function mapInvitacionPendienteComoInvite(row) {
  const pendiente = mapDbInvitacionPendiente(row);
  if (!pendiente) return null;

  return {
    id: pendiente.id,
    orderId: pendiente.orderId,
    pendingInviteId: pendiente.id,
    token: pendiente.token,
    senderName: pendiente.senderName,
    senderEmail: pendiente.senderEmail,
    recipientName: pendiente.recipientName,
    recipientPhone: pendiente.recipientPhone,
    message: pendiente.message,
    saveGuestOnConfirm: pendiente.saveGuestOnConfirm,
    guestAlias: pendiente.guestAlias,
    status: pendiente.status === "ubicacion_confirmada" ? "location_confirmed" : pendiente.status,
    statusEs: pendiente.status,
    shareUrl: pendiente.shareUrl,
    recipientAddress: pendiente.recipientAddress,
    recipientReference: pendiente.recipientReference,
    recipientLatitude: pendiente.recipientLatitude,
    recipientLongitude: pendiente.recipientLongitude,
    confirmedAt: pendiente.confirmedAt,
    expiresAt: pendiente.expiresAt,
    createdAt: pendiente.createdAt,
    updatedAt: pendiente.updatedAt,
    location: pendiente.location,
    pending: true
  };
}

async function getInvitacionPendienteByToken(token, clientOrPool = pool) {
  const result = await clientOrPool.query(
    `
    SELECT *
    FROM invitaciones_pendientes
    WHERE invite_token = $1
    LIMIT 1
    `,
    [String(token || "").trim()]
  );

  return result.rows[0] || null;
}

function mapDbSavedGuest(row) {
  if (!row) return null;

  return {
    id: row.id || "",
    ownerEmail: normalizeEmail(row.owner_email || ""),
    alias: row.alias || "",
    recipientName: row.recipient_name || "",
    recipientPhone: row.recipient_phone || "",
    address: row.address || "",
    reference: row.reference || "",
    latitude: row.latitude || "",
    longitude: row.longitude || "",
    sourceInviteId: row.source_invite_id || "",
    lastInviteId: row.last_invite_id || "",
    usageCount: Number(row.usage_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    location: {
      lat: row.latitude || "",
      lng: row.longitude || ""
    }
  };
}

app.get("/users/:email/saved-guests", async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const search = String(req.query.search || "").trim();

  if (!email) {
    return res.status(400).json({
      ok: false,
      message: "Correo inválido"
    });
  }

  try {
    const values = [email];
    let whereSearch = "";

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      whereSearch = `
        AND (
          LOWER(alias) LIKE $2 OR
          LOWER(COALESCE(recipient_name, '')) LIKE $2 OR
          LOWER(COALESCE(recipient_phone, '')) LIKE $2 OR
          LOWER(COALESCE(reference, '')) LIKE $2
        )
      `;
    }

    const result = await pool.query(
      `
      SELECT *
      FROM delivery_saved_guests
      WHERE LOWER(owner_email) = LOWER($1)
      ${whereSearch}
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 30
      `,
      values
    );

    return res.json({
      ok: true,
      source: "postgres",
      total: result.rows.length,
      guests: result.rows.map(mapDbSavedGuest)
    });
  } catch (error) {
    console.error("Error leyendo invitados guardados:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error leyendo invitados guardados",
      error: error.message
    });
  }
});

app.delete("/users/:email/saved-guests/:guestId", async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const guestId = String(req.params.guestId || "").trim();

  if (!email || !guestId) {
    return res.status(400).json({
      ok: false,
      message: "Datos inválidos para eliminar invitado"
    });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM delivery_saved_guests
      WHERE id = $1
        AND LOWER(owner_email) = LOWER($2)
      RETURNING *
      `,
      [guestId, email]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        message: "Invitado guardado no encontrado"
      });
    }

    return res.json({
      ok: true,
      source: "postgres",
      message: "Invitado eliminado correctamente",
      guest: mapDbSavedGuest(result.rows[0])
    });
  } catch (error) {
    console.error("Error eliminando invitado guardado:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error eliminando invitado guardado",
      error: error.message
    });
  }
});

async function saveGuestFromInvite(client, invite, payload) {
  const ownerEmail = normalizeEmail(invite?.sender_email || "");
  const alias = toNullableText(payload.guestAlias || invite?.recipient_name || "Invitado");
  const recipientName = toNullableText(invite?.recipient_name || alias);
  const recipientPhone = toNullableText(invite?.recipient_phone);
  const address = toNullableText(payload.address) || "Ubicación compartida por receptor invitado";
  const reference = toNullableText(payload.reference);
  const latitude = String(payload.latitude || "").trim();
  const longitude = String(payload.longitude || "").trim();

  if (!ownerEmail || !alias || !reference || !latitude || !longitude) {
    return null;
  }

  const existingResult = await client.query(
    `
    SELECT *
    FROM delivery_saved_guests
    WHERE LOWER(owner_email) = LOWER($1)
      AND LOWER(alias) = LOWER($2)
    LIMIT 1
    FOR UPDATE
    `,
    [ownerEmail, alias]
  );

  if (existingResult.rows.length) {
    const result = await client.query(
      `
      UPDATE delivery_saved_guests
      SET
        recipient_name = $1,
        recipient_phone = $2,
        address = $3,
        reference = $4,
        latitude = $5,
        longitude = $6,
        source_invite_id = COALESCE(source_invite_id, $7),
        last_invite_id = $7,
        usage_count = COALESCE(usage_count, 0) + 1,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        recipientName,
        recipientPhone,
        address,
        reference,
        latitude,
        longitude,
        invite.id,
        existingResult.rows[0].id
      ]
    );

    return mapDbSavedGuest(result.rows[0]);
  }

  const result = await client.query(
    `
    INSERT INTO delivery_saved_guests (
      id, owner_email, alias, recipient_name, recipient_phone,
      address, reference, latitude, longitude,
      source_invite_id, last_invite_id, usage_count,
      created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,1,NOW(),NOW())
    RETURNING *
    `,
    [
      generateId("guest"),
      ownerEmail,
      alias,
      recipientName,
      recipientPhone,
      address,
      reference,
      latitude,
      longitude,
      invite.id
    ]
  );

  return mapDbSavedGuest(result.rows[0]);
}


/* ======================================================
   BHUZ - INVITACIONES PENDIENTES
   - Flujo profesional: primero se confirma GPS del invitado.
   - El pedido real nace solo cuando el usuario confirma después del GPS.
====================================================== */
app.post("/invitaciones-pendientes", async (req, res) => {
  const {
    recipientName,
    recipientPhone,
    message,
    senderName,
    senderEmail,
    restaurantEmail,
    restaurantName,
    cart,
    subtotal,
    total,
    orderPayload,
    frontendBaseUrl,
    saveGuestOnConfirm,
    guestAlias
  } = req.body || {};

  const finalRecipientName = toNullableText(recipientName);
  const finalSenderEmail = normalizeEmail(senderEmail || orderPayload?.customer?.email || "");
  const finalRestaurantEmail = normalizeEmail(restaurantEmail || orderPayload?.restaurantEmail || orderPayload?.restaurant?.email || "");
  const finalCart = Array.isArray(cart) && cart.length ? cart : (Array.isArray(orderPayload?.items) ? orderPayload.items : []);
  const finalTotal = toNumberValue(total ?? orderPayload?.total, 0);
  const finalSubtotal = toNumberValue(subtotal ?? finalTotal, finalTotal);
  const finalSaveGuestOnConfirm = saveGuestOnConfirm === true || saveGuestOnConfirm === "true";
  const finalGuestAlias = toNullableText(guestAlias || recipientName);

  if (!finalSenderEmail) {
    return res.status(400).json({ ok: false, message: "Correo del usuario inválido" });
  }

  if (!finalRestaurantEmail) {
    return res.status(400).json({ ok: false, message: "Restaurante inválido" });
  }

  if (!finalRecipientName) {
    return res.status(400).json({ ok: false, message: "El nombre del receptor es obligatorio" });
  }

  if (!finalCart.length) {
    return res.status(400).json({ ok: false, message: "El carrito está vacío" });
  }

  try {
    const token = generateInviteToken();
    const baseUrl = normalizeFrontendBaseUrl(frontendBaseUrl, req);
    const shareUrl = buildInviteUrl(baseUrl, token);
    const id = generateId("invitacion");

    const result = await pool.query(
      `
      INSERT INTO invitaciones_pendientes (
        id, invite_token, sender_email, sender_name,
        recipient_name, recipient_phone, invite_message,
        restaurant_email, restaurant_name, cart_payload, order_payload,
        subtotal, total, invite_status, share_url,
        save_guest_on_confirm, guest_alias,
        expires_at, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,'pendiente',$14,$15,$16,NOW() + INTERVAL '24 hours',NOW(),NOW())
      RETURNING *
      `,
      [
        id,
        token,
        finalSenderEmail,
        toNullableText(senderName || orderPayload?.customer?.fullName || orderPayload?.customer?.name || ""),
        finalRecipientName,
        toNullableText(recipientPhone),
        toNullableText(message),
        finalRestaurantEmail,
        toNullableText(restaurantName || orderPayload?.restaurantName || orderPayload?.restaurant?.name || "Restaurante"),
        JSON.stringify(finalCart),
        JSON.stringify(orderPayload || {}),
        finalSubtotal,
        finalTotal,
        shareUrl,
        finalSaveGuestOnConfirm,
        finalGuestAlias
      ]
    );

    return res.status(201).json({
      ok: true,
      source: "postgres",
      message: "Invitación pendiente creada correctamente",
      invitacion: mapDbInvitacionPendiente(result.rows[0]),
      invite: mapInvitacionPendienteComoInvite(result.rows[0])
    });
  } catch (error) {
    console.error("Error creando invitación pendiente:", error.message);
    return res.status(500).json({
      ok: false,
      message: "Error creando invitación pendiente",
      error: error.message
    });
  }
});

app.get("/invitaciones-pendientes/:id/status", async (req, res) => {
  const id = String(req.params.id || "").trim();

  if (!id) {
    return res.status(400).json({ ok: false, message: "ID de invitación inválido" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM invitaciones_pendientes WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, message: "Invitación pendiente no encontrada" });
    }

    return res.json({
      ok: true,
      source: "postgres",
      invitacion: mapDbInvitacionPendiente(result.rows[0]),
      invite: mapInvitacionPendienteComoInvite(result.rows[0])
    });
  } catch (error) {
    console.error("Error consultando invitación pendiente:", error.message);
    return res.status(500).json({ ok: false, message: "Error consultando invitación pendiente", error: error.message });
  }
});

app.post("/invitaciones-pendientes/:id/crear-pedido", async (req, res) => {
  const id = String(req.params.id || "").trim();

  if (!id) {
    return res.status(400).json({ ok: false, message: "ID de invitación inválido" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pendingResult = await client.query(
      `
      SELECT *
      FROM invitaciones_pendientes
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [id]
    );

    if (!pendingResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Invitación pendiente no encontrada" });
    }

    const pending = pendingResult.rows[0];

    if (pending.invite_status === "pedido_creado" && pending.order_id) {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        source: "postgres",
        message: "El pedido ya había sido creado",
        invitacion: mapDbInvitacionPendiente(pending),
        order: await getOrderByIdFromPostgres(pending.order_id)
      });
    }

    if (pending.invite_status !== "ubicacion_confirmada") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        message: "La persona invitada todavía no confirmó su ubicación"
      });
    }

    const orderPayload = pending.order_payload || {};
    const finalAddress = pending.recipient_address || "Ubicación compartida por receptor invitado";
    const finalReference = pending.recipient_reference || "Referencia confirmada por receptor invitado";
    const finalLatitude = String(pending.recipient_latitude || "").trim();
    const finalLongitude = String(pending.recipient_longitude || "").trim();

    orderPayload.id = orderPayload.id || `DL-${Date.now()}`;
    orderPayload.deliveryAddress = finalAddress;
    orderPayload.deliveryReference = finalReference;
    orderPayload.latitude = finalLatitude;
    orderPayload.longitude = finalLongitude;
    orderPayload.location = { lat: finalLatitude, lng: finalLongitude };
    orderPayload.deliveryMode = "invite_location_confirmed";
    orderPayload.orderMode = "invite";
    orderPayload.invited = true;
    orderPayload.invitedRecipientName = pending.recipient_name || orderPayload.invitedRecipientName || "";
    orderPayload.invitedRecipientPhone = pending.recipient_phone || orderPayload.invitedRecipientPhone || "";
    orderPayload.invitedMessage = pending.invite_message || orderPayload.invitedMessage || "";
    orderPayload.notes = orderPayload.notes || "Pedido invitado: ubicación confirmada antes de crear el pedido.";
    orderPayload.customer = orderPayload.customer || {};
    orderPayload.customer.address = finalAddress;
    orderPayload.customer.reference = finalReference;
    orderPayload.customer.deliveryMode = "invite_location_confirmed";
    orderPayload.customer.orderMode = "invite";
    orderPayload.customer.invited = true;
    orderPayload.customer.location = { lat: finalLatitude, lng: finalLongitude };

    await client.query("COMMIT");

    const createdOrder = await createOrderInPostgres(orderPayload);

    const logClient = await pool.connect();
    try {
      await logClient.query("BEGIN");

      const inviteLogResult = await logClient.query(
        `
        INSERT INTO delivery_invites (
          id, order_id, invite_token, sender_name, sender_email,
          recipient_name, recipient_phone, invite_message, invite_status,
          share_url, save_guest_on_confirm, guest_alias,
          recipient_address, recipient_reference, recipient_latitude, recipient_longitude,
          confirmed_at, expires_at, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'location_confirmed',$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
        ON CONFLICT (invite_token) DO UPDATE SET
          order_id = EXCLUDED.order_id,
          invite_status = 'location_confirmed',
          recipient_address = EXCLUDED.recipient_address,
          recipient_reference = EXCLUDED.recipient_reference,
          recipient_latitude = EXCLUDED.recipient_latitude,
          recipient_longitude = EXCLUDED.recipient_longitude,
          confirmed_at = EXCLUDED.confirmed_at,
          updated_at = NOW()
        RETURNING *
        `,
        [
          generateId("invite"),
          createdOrder.id,
          pending.invite_token,
          pending.sender_name,
          pending.sender_email,
          pending.recipient_name,
          pending.recipient_phone,
          pending.invite_message,
          pending.share_url,
          pending.save_guest_on_confirm === true,
          pending.guest_alias || pending.recipient_name,
          finalAddress,
          finalReference,
          finalLatitude,
          finalLongitude,
          pending.confirmed_at || new Date().toISOString(),
          pending.expires_at
        ]
      );

      let savedGuest = null;
      if (pending.save_guest_on_confirm === true) {
        savedGuest = await saveGuestFromInvite(logClient, inviteLogResult.rows[0], {
          guestAlias: pending.guest_alias || pending.recipient_name,
          address: finalAddress,
          reference: finalReference,
          latitude: finalLatitude,
          longitude: finalLongitude
        });
      }

      const updatedPendingResult = await logClient.query(
        `
        UPDATE invitaciones_pendientes
        SET invite_status = 'pedido_creado', order_id = $1, order_payload = $2::jsonb, updated_at = NOW()
        WHERE id = $3
        RETURNING *
        `,
        [createdOrder.id, JSON.stringify(orderPayload), id]
      );

      await logClient.query("COMMIT");

      return res.status(201).json({
        ok: true,
        source: "postgres",
        message: savedGuest
          ? "Pedido creado e invitado frecuente guardado"
          : "Pedido creado correctamente",
        invitacion: mapDbInvitacionPendiente(updatedPendingResult.rows[0]),
        invite: mapDbDeliveryInvite(inviteLogResult.rows[0]),
        savedGuest,
        order: createdOrder
      });
    } catch (error) {
      await logClient.query("ROLLBACK");
      throw error;
    } finally {
      logClient.release();
    }
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error creando pedido desde invitación pendiente:", error.message);
    return res.status(500).json({
      ok: false,
      message: "Error creando pedido desde invitación pendiente",
      error: error.message
    });
  } finally {
    client.release();
  }
});

app.post("/orders/:orderId/invite", async (req, res) => {
  const orderId = String(req.params.orderId || "").trim();

  const {
    recipientName,
    recipientPhone,
    message,
    senderName,
    senderEmail,
    frontendBaseUrl,
    saveGuestOnConfirm,
    guestAlias
  } = req.body || {};

  const finalRecipientName = toNullableText(recipientName);
  const finalRecipientPhone = toNullableText(recipientPhone);
  const finalMessage = toNullableText(message);
  const finalSenderName = toNullableText(senderName);
  const finalSenderEmail = normalizeEmail(senderEmail || "");
  const finalSaveGuestOnConfirm = saveGuestOnConfirm === true || saveGuestOnConfirm === "true";
  const finalGuestAlias = toNullableText(guestAlias || recipientName);

  if (!orderId) {
    return res.status(400).json({
      ok: false,
      message: "ID de pedido inválido"
    });
  }

  if (!finalRecipientName) {
    return res.status(400).json({
      ok: false,
      message: "El nombre del receptor es obligatorio"
    });
  }

  try {
    const order = await getOrderByIdFromPostgres(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado"
      });
    }

    const existingResult = await pool.query(
      `
      SELECT *
      FROM delivery_invites
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [orderId]
    );

    if (existingResult.rows.length) {
      return res.status(200).json({
        ok: true,
        source: "postgres",
        message: "Este pedido ya tiene un link de invitación",
        invite: mapDbDeliveryInvite(existingResult.rows[0])
      });
    }

    const token = generateInviteToken();
    const baseUrl = normalizeFrontendBaseUrl(frontendBaseUrl, req);
    const shareUrl = buildInviteUrl(baseUrl, token);

    const result = await pool.query(
      `
      INSERT INTO delivery_invites (
        id, order_id, invite_token, sender_name, sender_email,
        recipient_name, recipient_phone, invite_message, invite_status,
        share_url, save_guest_on_confirm, guest_alias,
        expires_at, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_location',$9,$10,$11,NOW() + INTERVAL '24 hours',NOW(),NOW())
      RETURNING *
      `,
      [
        generateId("invite"),
        orderId,
        token,
        finalSenderName,
        finalSenderEmail || null,
        finalRecipientName,
        finalRecipientPhone,
        finalMessage,
        shareUrl,
        finalSaveGuestOnConfirm,
        finalGuestAlias
      ]
    );

    return res.status(201).json({
      ok: true,
      source: "postgres",
      message: "Link de invitación creado correctamente",
      invite: mapDbDeliveryInvite(result.rows[0])
    });
  } catch (error) {
    console.error("Error creando invitación de comida:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error creando invitación de comida",
      error: error.message
    });
  }
});

app.get("/invite/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();

  if (!token) {
    return res.status(400).json({
      ok: false,
      message: "Token inválido"
    });
  }

  try {
    const pending = await getInvitacionPendienteByToken(token);

    if (pending) {
      /* ======================================================
         BHUZ - SEGUIMIENTO REAL PARA INVITADO
         - Antes este endpoint devolvía el estado de invitaciones_pendientes.
         - Cuando el pedido ya estaba creado, el invitado seguía viendo
           "pedido_creado" o datos viejos y no el estado real de orders.
         - Ahora, si la invitación pendiente ya tiene order_id, consultamos
           la orden real en PostgreSQL y devolvemos su estado actualizado.
      ====================================================== */
      let linkedOrder = null;

      if (pending.order_id) {
        try {
          linkedOrder = await getOrderByIdFromPostgres(pending.order_id);
        } catch (orderError) {
          console.warn("BHUZ: no se pudo cargar pedido real de invitación:", orderError.message);
        }
      }

      return res.json({
        ok: true,
        source: "postgres",
        type: "invitacion_pendiente",
        invite: mapInvitacionPendienteComoInvite(pending),
        invitacion: mapDbInvitacionPendiente(pending),
        order: {
          id: linkedOrder?.id || pending.order_id || "",
          restaurantName: linkedOrder?.restaurantName || linkedOrder?.restaurant_name || pending.restaurant_name || "Restaurante",
          total: Number(linkedOrder?.total || pending.total || 0),
          status: linkedOrder?.status || pending.invite_status || "pendiente"
        }
      });
    }

    const result = await pool.query(
      `
      SELECT
        di.*,
        o.restaurant_name,
        o.total,
        o.status AS order_status
      FROM delivery_invites di
      INNER JOIN orders o ON o.id = di.order_id
      WHERE di.invite_token = $1
      LIMIT 1
      `,
      [token]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        message: "Invitación no encontrada"
      });
    }

    const row = result.rows[0];

    return res.json({
      ok: true,
      source: "postgres",
      type: "delivery_invite",
      invite: mapDbDeliveryInvite(row),
      order: {
        id: row.order_id || "",
        restaurantName: row.restaurant_name || "Restaurante",
        total: Number(row.total || 0),
        status: row.order_status || "pendiente"
      }
    });
  } catch (error) {
    console.error("Error leyendo invitación:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error leyendo invitación",
      error: error.message
    });
  }
});

app.post("/invite/:token/location", async (req, res) => {
  const token = String(req.params.token || "").trim();

  const {
    address,
    reference,
    latitude,
    longitude,
    location,
    saveGuest,
    guestAlias
  } = req.body || {};

  const finalAddress = toNullableText(address) || "Ubicación compartida por receptor invitado";
  const finalReference = toNullableText(reference);
  const finalLatitude = String(latitude || location?.lat || "").trim();
  const finalLongitude = String(longitude || location?.lng || "").trim();

  if (!token) {
    return res.status(400).json({ ok: false, message: "Token inválido" });
  }

  if (!finalReference || !finalLatitude || !finalLongitude) {
    return res.status(400).json({ ok: false, message: "Referencia y ubicación GPS son obligatorias" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pendingResult = await client.query(
      `
      SELECT *
      FROM invitaciones_pendientes
      WHERE invite_token = $1
      LIMIT 1
      FOR UPDATE
      `,
      [token]
    );

    if (pendingResult.rows.length) {
      const pending = pendingResult.rows[0];

      if (pending.invite_status === "pedido_creado") {
        await client.query("COMMIT");
        return res.json({
          ok: true,
          source: "postgres",
          type: "invitacion_pendiente",
          message: "Esta invitación ya fue convertida en pedido",
          invite: mapInvitacionPendienteComoInvite(pending),
          invitacion: mapDbInvitacionPendiente(pending),
          order: pending.order_id ? await getOrderByIdFromPostgres(pending.order_id) : null
        });
      }

      const updatedPendingResult = await client.query(
        `
        UPDATE invitaciones_pendientes
        SET
          invite_status = 'ubicacion_confirmada',
          recipient_address = $1,
          recipient_reference = $2,
          recipient_latitude = $3,
          recipient_longitude = $4,
          confirmed_at = COALESCE(confirmed_at, NOW()),
          updated_at = NOW()
        WHERE invite_token = $5
        RETURNING *
        `,
        [finalAddress, finalReference, finalLatitude, finalLongitude, token]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        type: "invitacion_pendiente",
        message: "Ubicación confirmada correctamente. La persona que te invitó ahora podrá crear el pedido.",
        invite: mapInvitacionPendienteComoInvite(updatedPendingResult.rows[0]),
        invitacion: mapDbInvitacionPendiente(updatedPendingResult.rows[0]),
        savedGuest: null,
        order: {
          id: "",
          restaurantName: updatedPendingResult.rows[0].restaurant_name || "Restaurante",
          total: Number(updatedPendingResult.rows[0].total || 0),
          status: "ubicacion_confirmada"
        }
      });
    }

    const inviteResult = await client.query(
      `
      SELECT *
      FROM delivery_invites
      WHERE invite_token = $1
      LIMIT 1
      FOR UPDATE
      `,
      [token]
    );

    if (!inviteResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Invitación no encontrada" });
    }

    const invite = inviteResult.rows[0];

    if (invite.invite_status === "location_confirmed") {
      let savedGuest = null;

      if (saveGuest === true || saveGuest === "true" || invite.save_guest_on_confirm === true) {
        savedGuest = await saveGuestFromInvite(client, invite, {
          guestAlias: (guestAlias || invite.guest_alias || invite.recipient_name),
          address: invite.recipient_address || finalAddress,
          reference: invite.recipient_reference || finalReference,
          latitude: invite.recipient_latitude || finalLatitude,
          longitude: invite.recipient_longitude || finalLongitude
        });
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        source: "postgres",
        type: "delivery_invite",
        message: savedGuest
          ? "Esta invitación ya tenía ubicación y fue guardada como invitado frecuente"
          : "Esta invitación ya tiene ubicación confirmada",
        invite: mapDbDeliveryInvite(invite),
        savedGuest,
        order: await getOrderByIdFromPostgres(invite.order_id)
      });
    }

    const updatedInviteResult = await client.query(
      `
      UPDATE delivery_invites
      SET
        invite_status = 'location_confirmed',
        recipient_address = $1,
        recipient_reference = $2,
        recipient_latitude = $3,
        recipient_longitude = $4,
        confirmed_at = NOW(),
        updated_at = NOW()
      WHERE invite_token = $5
      RETURNING *
      `,
      [finalAddress, finalReference, finalLatitude, finalLongitude, token]
    );

    await client.query(
      `
      UPDATE orders
      SET
        delivery_address = $1,
        delivery_reference = $2,
        latitude = $3,
        longitude = $4,
        notes = COALESCE(NULLIF(notes, ''), 'Pedido invitado: ubicación confirmada por el receptor.'),
        updated_at = NOW()
      WHERE id = $5
      `,
      [finalAddress, finalReference, finalLatitude, finalLongitude, invite.order_id]
    );

    let savedGuest = null;

    if (saveGuest === true || saveGuest === "true" || invite.save_guest_on_confirm === true) {
      savedGuest = await saveGuestFromInvite(client, invite, {
        guestAlias: (guestAlias || invite.guest_alias || invite.recipient_name),
        address: finalAddress,
        reference: finalReference,
        latitude: finalLatitude,
        longitude: finalLongitude
      });
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      source: "postgres",
      type: "delivery_invite",
      message: savedGuest
        ? "Ubicación confirmada y guardada como invitado frecuente"
        : "Ubicación confirmada correctamente",
      invite: mapDbDeliveryInvite(updatedInviteResult.rows[0]),
      savedGuest,
      order: await getOrderByIdFromPostgres(invite.order_id)
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error confirmando ubicación de invitación:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error confirmando ubicación de invitación",
      error: error.message
    });
  } finally {
    client.release();
  }
});


/* ======================================================
   BHUZ - GUARDAR INVITADO DESPUÉS DE CONFIRMAR GPS
   - Permite guardar un invitado aunque la ubicación ya haya sido confirmada.
   - Evita perder la dirección si el receptor confirmó GPS sin marcar el checkbox.
====================================================== */
app.post("/invite/:token/save-guest", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const { guestAlias } = req.body || {};
  const finalAlias = toNullableText(guestAlias);

  if (!token) {
    return res.status(400).json({
      ok: false,
      message: "Token inválido"
    });
  }

  if (!finalAlias) {
    return res.status(400).json({
      ok: false,
      message: "Escribe un apodo para guardar este invitado"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const inviteResult = await client.query(
      `
      SELECT *
      FROM delivery_invites
      WHERE invite_token = $1
      LIMIT 1
      FOR UPDATE
      `,
      [token]
    );

    if (!inviteResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        ok: false,
        message: "Invitación no encontrada"
      });
    }

    const invite = inviteResult.rows[0];

    if (
      !invite.recipient_reference ||
      !invite.recipient_latitude ||
      !invite.recipient_longitude
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        message: "Primero debe confirmarse la ubicación GPS del invitado"
      });
    }

    const savedGuest = await saveGuestFromInvite(client, invite, {
      guestAlias: finalAlias,
      address: invite.recipient_address || "Ubicación compartida por receptor invitado",
      reference: invite.recipient_reference,
      latitude: invite.recipient_latitude,
      longitude: invite.recipient_longitude
    });

    if (!savedGuest) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        message: "No se pudo guardar el invitado. Verifica que la invitación tenga correo del usuario que envió la comida."
      });
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      source: "postgres",
      message: "Invitado guardado correctamente",
      guest: savedGuest
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Error guardando invitado desde invitación confirmada:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Error guardando invitado",
      error: error.message
    });
  } finally {
    client.release();
  }
});



/* ======================================================
   RUTAS SERVICES BHUZ
   - Backend real y escalable para envíos y futuros servicios.
   - POST /api/services
   - GET /api/services/:id
   - POST /api/services/:id/receiver-token
   - GET /api/services/confirmar/:token
   - POST /api/services/confirmar/:token
   - POST /api/services/:id/status
   - POST /api/services/:id/confirm-delivery
====================================================== */
app.use("/api/services", crearRutasServices({
  pool
}));

/* ======================================================
   RUTAS PEDIDOS MODULARIZADAS
   - POST /orders
   - GET /orders
   - GET /orders/restaurant/:email
   - GET /orders/customer/:email
   - PATCH /orders/:id/status
   - La lógica fue movida a routes/pedidos.routes.js
====================================================== */
app.use("/orders", crearRutasPedidos({
  pool,
  normalizeEmail,
  normalizeOrderStatus,
  createOrderInPostgres,
  getOrdersFromPostgres,
  getOrderByIdFromPostgres
}));


/* ======================================================
   RUTAS ADMIN MODULARIZADAS
   - POST /admin/login
   - GET /admin/datos
   - PATCH /admin/restaurantes/:id/estado
   - PATCH /admin/users/:id
   - PATCH /admin/restaurantes/:id
   - DELETE /admin/restaurantes/:id
   - PATCH /admin/restaurantes/:id/comision
   - La lógica fue movida a routes/admin.routes.js
====================================================== */
app.use("/admin", crearRutasAdmin({
  pool,
  normalizeEmail,
  normalizeText,
  createSession,
  getUsersFromPostgres,
  getRestaurantsFromPostgres,
  getOrdersFromPostgres,
  mapDbUser,
  mapDbRestaurant
}));

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
app.post("/db-migrate", async (req, res) => {
  if (!process.env.MIGRATION_SECRET || req.get("x-migration-secret") !== process.env.MIGRATION_SECRET) {
    return res.status(404).json({ ok: false, message: "Ruta no disponible" });
  }
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




