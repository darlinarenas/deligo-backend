console.log("SERVER NUEVO CON ADMIN ACTIVO");

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

const ORDERS_FILE = path.join(__dirname, "orders.json");
const USERS_FILE = path.join(__dirname, "users.json");
const RESTAURANTS_FILE = path.join(__dirname, "restaurants.json");
const DISHES_FILE = path.join(__dirname, "dishes.json");
const ADMINS_FILE = path.join(__dirname, "admins.json");

app.use(cors({
  origin: [
    "https://deli-go-frontend-gamma.vercel.app",
    "https://deli-go-frontend-wheat.vercel.app",
    "https://deli-go-frontend-ehvy3lg9j-vexhora.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

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
   SESIONES EN MEMORIA
   - Permite login real con cookie HTTP-only
   - Soporta /session para cliente, restaurante y admin
   - No usa localStorage como fuente de sesión
====================================================== */
const ACTIVE_SESSIONS = {};

function parseCookies(req) {
  const header = req.headers.cookie || "";

  return header.split(";").reduce((cookies, part) => {
    const [key, ...valueParts] = part.trim().split("=");

    if (!key) return cookies;

    cookies[key] = decodeURIComponent(valueParts.join("=") || "");
    return cookies;
  }, {});
}

function createSession(res, user) {
  const token = generateId("session");

  ACTIVE_SESSIONS[token] = {
    ...user,
    createdAt: new Date().toISOString()
  };

  res.setHeader(
    "Set-Cookie",
    `deli_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`
  );

  return token;
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const cookieToken = cookies.deli_session;

  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "").trim()
    : "";

  const token = cookieToken || bearerToken;

  if (!token) return null;

  return ACTIVE_SESSIONS[token] || null;
}

function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies.deli_session;

  if (token && ACTIVE_SESSIONS[token]) {
    delete ACTIVE_SESSIONS[token];
  }

  res.setHeader(
    "Set-Cookie",
    "deli_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0"
  );
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

    createSession(res, restaurant);

    return res.json({
      ok: true,
      message: "Login correcto",
      user: restaurant
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

  createSession(res, user);

  res.json({
    ok: true,
    message: "Login correcto",
    user
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

  const sessionToken = createSession(res, admin);

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
   SESIÓN ACTUAL
====================================================== */
app.get("/session", (req, res) => {
  const sessionUser = getSessionUser(req);

  if (!sessionUser) {
    return res.status(401).json({
      ok: false,
      message: "Sesión no activa"
    });
  }

  if (sessionUser.role === "admin") {
    return res.json({
      ok: true,
      admin: sessionUser
    });
  }

  return res.json({
    ok: true,
    user: sessionUser
  });
});

app.post("/logout", (req, res) => {
  destroySession(req, res);

  res.json({
    ok: true,
    message: "Sesión cerrada correctamente"
  });
});


app.listen(PORT, () => {
  console.log("=================================");
  console.log("🚀 DELI BACKEND ACTIVO");
  console.log("🌐 http://localhost:" + PORT);
  console.log("=================================");
});































