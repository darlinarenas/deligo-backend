const express = require("express");

/* ======================================================
   RUTAS ADMIN
   - Este archivo separa las rutas administrativas reales.
   - Mantiene las mismas rutas públicas bajo /admin.
   - No cambia respuestas del frontend.
   - No toca auth cliente/restaurante, pedidos, platos ni estadísticas.
====================================================== */

function crearRutasAdmin(dependencias) {
  const router = express.Router();

  const {
    pool,
    normalizeEmail,
    normalizeText,
    createSession,
    getUsersFromPostgres,
    getRestaurantsFromPostgres,
    getOrdersFromPostgres,
    mapDbUser,
    mapDbRestaurant
  } = dependencias;

/* ======================================================
   ADMIN LOGIN - SOLO POSTGRESQL
====================================================== */
router.post("/login", async (req, res) => {
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
router.get("/datos", async (req, res) => {
  try {
    const users = await getUsersFromPostgres();
    const restaurants = await getRestaurantsFromPostgres();
    const orders = await getOrdersFromPostgres();
    const servicesResult = await pool.query(`
      SELECT
        s.*,
        COALESCE(j.status, '') AS delivery_job_status,
        COALESCE(j.driver_id, s.driver_id, '') AS assigned_driver_id,
        COALESCE(d.full_name, s.driver_name, '') AS assigned_driver_name,
        COALESCE(d.phone, s.driver_phone, '') AS assigned_driver_phone,
        COALESCE(d.vehicle_type, '') AS driver_vehicle_type,
        COALESCE(d.vehicle_plate, '') AS driver_vehicle_plate,
        j.accepted_at, j.picked_up_at, j.delivered_at
      FROM bhuz_services s
      LEFT JOIN bhuz_delivery_jobs j
        ON j.source_type = 'PACKAGE' AND j.source_id = s.id
      LEFT JOIN bhuz_drivers d
        ON d.id = COALESCE(j.driver_id, s.driver_id)
      ORDER BY s.created_at DESC
      LIMIT 500
    `);

    const services = servicesResult.rows.map((row) => ({
      id: row.id,
      serviceType: row.service_type,
      customerEmail: row.customer_email || '',
      customerName: row.customer_name || '',
      customerPhone: row.customer_phone || '',
      receiverName: row.receiver_name || '',
      receiverPhone: row.receiver_phone || '',
      pickupAddress: row.pickup_address || '',
      pickupReference: row.pickup_reference || '',
      deliveryAddress: row.delivery_address || '',
      deliveryReference: row.delivery_reference || '',
      packageDescription: row.package_description || '',
      packageSize: row.package_size || '',
      distanceKm: Number(row.distance_km || 0),
      totalAmount: Number(row.total_amount || 0),
      paymentStatus: row.payment_status || '',
      paymentMethod: row.payment_method || '',
      status: row.status || '',
      driverId: row.assigned_driver_id || '',
      driverName: row.assigned_driver_name || '',
      driverPhone: row.assigned_driver_phone || '',
      driverVehicleType: row.driver_vehicle_type || '',
      driverVehiclePlate: row.driver_vehicle_plate || '',
      deliveryJobStatus: row.delivery_job_status || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      acceptedAt: row.accepted_at,
      pickedUpAt: row.picked_up_at,
      deliveredAt: row.delivered_at
    }));

    return res.json({
      ok: true,
      source: "postgres",
      data: { users, restaurants, orders, services }
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
router.patch("/restaurantes/:id/estado", async (req, res) => {
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
router.patch("/users/:id", async (req, res) => {
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
router.patch("/restaurantes/:id", async (req, res) => {
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
router.delete("/restaurantes/:id", async (req, res) => {
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
router.patch("/restaurantes/:id/comision", async (req, res) => {
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
router.patch("/restaurants/:id/status", async (req, res) => {
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

router.delete("/restaurants/:id", async (req, res) => {
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
   ADMIN REPARTIDORES
====================================================== */
function mapAdminDriver(row) {
  return row ? {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    identityDocument: row.identity_document,
    birthDate: row.birth_date,
    address: row.address,
    countryCode: row.country_code,
    city: row.city,
    zone: row.zone,
    vehicleType: row.vehicle_type,
    vehicleBrand: row.vehicle_brand,
    vehicleModel: row.vehicle_model,
    vehiclePlate: row.vehicle_plate,
    vehicleColor: row.vehicle_color,
    emergencyContact: row.emergency_contact,
    administrativeStatus: row.administrative_status,
    operationalStatus: row.operational_status,
    isAvailable: !!row.is_available,
    rating: Number(row.rating || 0),
    completedDeliveries: Number(row.completed_deliveries || 0),
    acceptanceRate: Number(row.acceptance_rate || 0),
    commissionPercent: Number(row.commission_percent || 0),
    baseCurrency: row.base_currency || "USD",
    lastLatitude: row.last_latitude,
    lastLongitude: row.last_longitude,
    lastLocationAt: row.last_location_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

router.get("/drivers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM bhuz_drivers
      ORDER BY
        CASE administrative_status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
        created_at DESC
    `);
    return res.json({ ok: true, drivers: result.rows.map(mapAdminDriver) });
  } catch (error) {
    console.error("Error listando repartidores:", error.message);
    return res.status(500).json({ ok: false, message: "No se pudieron cargar los repartidores." });
  }
});

router.get("/drivers/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM bhuz_drivers WHERE id=$1 LIMIT 1`, [req.params.id]);
    const driver = result.rows[0];
    if (!driver) return res.status(404).json({ ok:false, message:"Repartidor no encontrado." });
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE j.status='DELIVERED')::int AS completed_jobs,
        COALESCE(SUM(j.driver_earning) FILTER (WHERE j.status='DELIVERED'),0) AS total_earnings,
        (SELECT COUNT(*)::int FROM bhuz_driver_incidents i WHERE i.driver_id=$1 AND i.status IN ('OPEN','REVIEWING')) AS open_incidents,
        (SELECT COUNT(*)::int FROM bhuz_driver_settlements s WHERE s.driver_id=$1 AND s.status IN ('DRAFT','PENDING','PARTIALLY_PAID','DISPUTED')) AS pending_settlements
      FROM bhuz_delivery_jobs j WHERE j.driver_id=$1
    `, [req.params.id]);
    const row=summary.rows[0]||{};
    return res.json({ok:true,driver:mapAdminDriver(driver),summary:{completedJobs:Number(row.completed_jobs||0),totalEarnings:Number(row.total_earnings||0),openIncidents:Number(row.open_incidents||0),pendingSettlements:Number(row.pending_settlements||0)}});
  } catch (error) {
    console.error("Error leyendo repartidor:", error.message);
    return res.status(500).json({ok:false,message:"No se pudo cargar la ficha del repartidor."});
  }
});

router.patch("/drivers/:id/status", async (req, res) => {
  const status=String(req.body?.status||"").trim().toUpperCase();
  const valid=["PENDING","APPROVED","SUSPENDED","BLOCKED","REJECTED"];
  if(!valid.includes(status)) return res.status(400).json({ok:false,message:"Estado de repartidor inválido."});
  try {
    const operational=status==='APPROVED'?'OFFLINE':'OFFLINE';
    const result=await pool.query(`
      UPDATE bhuz_drivers SET administrative_status=$2, operational_status=$3,
        is_available=FALSE, updated_at=NOW()
      WHERE id=$1 RETURNING *
    `,[req.params.id,status,operational]);
    if(!result.rows[0]) return res.status(404).json({ok:false,message:"Repartidor no encontrado."});
    return res.json({ok:true,message:`Repartidor ${status==='APPROVED'?'aprobado':'actualizado'} correctamente.`,driver:mapAdminDriver(result.rows[0])});
  } catch(error) {
    console.error("Error cambiando estado de repartidor:",error.message);
    return res.status(500).json({ok:false,message:"No se pudo actualizar el estado del repartidor."});
  }
});


  return router;
}

module.exports = crearRutasAdmin;

