console.log("SERVER NUEVO CON ADMIN ACTIVO");

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

const ORDERS_FILE = path.join(__dirname, "orders.json");
const USERS_FILE = path.join(__dirname, "users.json");
const RESTAURANTS_FILE = path.join(__dirname, "restaurants.json");
const DISHES_FILE = path.join(__dirname, "dishes.json");
const ADMINS_FILE = path.join(__dirname, "admins.json");
const SESSIONS_FILE = path.join(__dirname, "sessions.json");

/* ======================================================
   CORS DEFINITIVO PARA FRONTEND EN VERCEL
   - Necesario porque el frontend usa credentials: "include".
   - NO se puede usar origin: "*" con cookies.
   - El backend debe responder con el origen exacto permitido.
====================================================== */
const ALLOWED_ORIGINS = [
  "https://deli-go-frontend-gamma.vercel.app",
  "https://deli-go.netlify.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

const corsOptions = {
  origin(origin, callback) {
    // Permite herramientas como Postman, navegador directo o health checks sin Origin.
    if (!origin) {
      return callback(null, true);
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origen no permitido por CORS: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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
  const sessionId = cookies.deli_session;
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

  createSession(res, { ...admin, role: "admin" }, "admin");

  res.json({
    ok: true,
    message: "Login admin correcto",
    admin
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


app.listen(PORT, () => {
  console.log("=================================");
  console.log("🚀 DELI BACKEND ACTIVO");
  console.log("🌐 http://localhost:" + PORT);
  console.log("=================================");
});



























