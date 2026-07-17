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

    const [summaryQ,jobsQ,settlementsQ,requestsQ,ratingsQ,incidentsQ] = await Promise.all([
      pool.query(`SELECT
        COUNT(*)::int total_jobs,
        COUNT(*) FILTER(WHERE status='DELIVERED')::int completed_jobs,
        COUNT(*) FILTER(WHERE status='CANCELLED')::int cancelled_jobs,
        COUNT(*) FILTER(WHERE status NOT IN ('DELIVERED','CANCELLED'))::int active_jobs,
        COUNT(*) FILTER(WHERE source_type='PACKAGE')::int package_jobs,
        COUNT(*) FILTER(WHERE source_type='FOOD_ORDER')::int food_jobs,
        COALESCE(SUM(driver_earning) FILTER(WHERE status='DELIVERED'),0) total_earnings,
        COALESCE(SUM(distance_km) FILTER(WHERE status='DELIVERED'),0) planned_distance_km,
        COALESCE(SUM(actual_distance_km) FILTER(WHERE status='DELIVERED'),0) actual_distance_km
        FROM bhuz_delivery_jobs WHERE driver_id=$1`,[req.params.id]),
      pool.query(`SELECT j.*,COALESCE(s.customer_name,o.customer_name,j.delivery_name) customer_name,
        COALESCE(s.receiver_name,o.customer_name,j.delivery_name) receiver_name,
        COALESCE(o.restaurant_name,j.pickup_name) restaurant_name
        FROM bhuz_delivery_jobs j
        LEFT JOIN bhuz_services s ON j.source_type='PACKAGE' AND s.id=j.source_id
        LEFT JOIN orders o ON j.source_type='FOOD_ORDER' AND o.id=j.source_id
        WHERE j.driver_id=$1 ORDER BY j.created_at DESC LIMIT 300`,[req.params.id]),
      pool.query(`SELECT * FROM bhuz_driver_settlements WHERE driver_id=$1 ORDER BY period_to DESC LIMIT 100`,[req.params.id]),
      pool.query(`SELECT * FROM bhuz_driver_settlement_requests WHERE driver_id=$1 ORDER BY requested_at DESC LIMIT 100`,[req.params.id]),
      pool.query(`SELECT * FROM bhuz_ratings WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 200`,[req.params.id]),
      pool.query(`SELECT * FROM bhuz_driver_incidents WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 100`,[req.params.id])
    ]);
    const row=summaryQ.rows[0]||{};
    const ratingSummary=ratingsQ.rows.reduce((a,r)=>{if(r.driver_rating){a.total++;a.sum+=Number(r.driver_rating)}return a},{total:0,sum:0});
    return res.json({ok:true,driver:mapAdminDriver(driver),summary:{
      totalJobs:Number(row.total_jobs||0),completedJobs:Number(row.completed_jobs||0),cancelledJobs:Number(row.cancelled_jobs||0),activeJobs:Number(row.active_jobs||0),packageJobs:Number(row.package_jobs||0),foodJobs:Number(row.food_jobs||0),totalEarnings:Number(row.total_earnings||0),plannedDistanceKm:Number(row.planned_distance_km||0),actualDistanceKm:Number(row.actual_distance_km||0),ratingAverage:ratingSummary.total?ratingSummary.sum/ratingSummary.total:Number(driver.rating||0),ratingCount:ratingSummary.total
    },jobs:jobsQ.rows,settlements:settlementsQ.rows,settlementRequests:requestsQ.rows,ratings:ratingsQ.rows,incidents:incidentsQ.rows});
  } catch (error) {
    console.error("Error leyendo repartidor:", error.message);
    return res.status(500).json({ok:false,message:"No se pudo cargar la ficha completa del repartidor."});
  }
});

router.patch("/drivers/:id", async(req,res)=>{
  const b=req.body||{};
  try {
    const q=await pool.query(`UPDATE bhuz_drivers SET
      full_name=COALESCE(NULLIF($2,''),full_name),phone=COALESCE(NULLIF($3,''),phone),identity_document=COALESCE(NULLIF($4,''),identity_document),
      birth_date=COALESCE(NULLIF($5,'')::date,birth_date),address=COALESCE(NULLIF($6,''),address),country_code=COALESCE(NULLIF($7,''),country_code),city=COALESCE(NULLIF($8,''),city),zone=COALESCE(NULLIF($9,''),zone),
      vehicle_type=COALESCE(NULLIF($10,''),vehicle_type),vehicle_brand=COALESCE(NULLIF($11,''),vehicle_brand),vehicle_model=COALESCE(NULLIF($12,''),vehicle_model),vehicle_plate=COALESCE(NULLIF($13,''),vehicle_plate),vehicle_color=COALESCE(NULLIF($14,''),vehicle_color),emergency_contact=COALESCE(NULLIF($15,''),emergency_contact),updated_at=NOW()
      WHERE id=$1 RETURNING *`,[req.params.id,b.fullName||'',b.phone||'',b.identityDocument||'',b.birthDate||'',b.address||'',b.countryCode||'',b.city||'',b.zone||'',b.vehicleType||'',b.vehicleBrand||'',b.vehicleModel||'',b.vehiclePlate||'',b.vehicleColor||'',b.emergencyContact||'']);
    if(!q.rows[0]) return res.status(404).json({ok:false,message:'Repartidor no encontrado.'});
    res.json({ok:true,message:'Datos del repartidor actualizados.',driver:mapAdminDriver(q.rows[0])});
  } catch(error){console.error(error);res.status(500).json({ok:false,message:'No se pudieron actualizar los datos del repartidor.'});}
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


/* ======================================================
   ADMIN PAQUETES - ENDPOINT INDEPENDIENTE
   Importante: esta consulta NO forma parte de /admin/datos.
   Así, si el módulo de paquetes falla, no rompe Resumen,
   Usuarios, Restaurantes, Pedidos ni Comisiones.
====================================================== */
router.get("/services", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH position_steps AS (
        SELECT delivery_job_id, latitude, longitude,
          LAG(latitude) OVER(PARTITION BY delivery_job_id ORDER BY created_at) prev_lat,
          LAG(longitude) OVER(PARTITION BY delivery_job_id ORDER BY created_at) prev_lon
        FROM bhuz_delivery_positions
      ), travelled AS (
        SELECT delivery_job_id, COALESCE(SUM(CASE WHEN prev_lat IS NULL THEN 0 ELSE
          6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(latitude-prev_lat)/2),2)+COS(RADIANS(prev_lat))*COS(RADIANS(latitude))*POWER(SIN(RADIANS(longitude-prev_lon)/2),2))) END),0) actual_distance_km
        FROM position_steps GROUP BY delivery_job_id
      )
      SELECT s.*,COALESCE(NULLIF(u.full_name,''),NULLIF(u.name,''),s.customer_name,s.customer_email) registered_sender_name,
        u.phone registered_sender_phone,j.status delivery_job_status,j.driver_id job_driver_id,j.assigned_at,j.picked_up_at,j.delivered_at,
        j.distance_km route_distance_km,COALESCE(NULLIF(j.actual_distance_km,0),t.actual_distance_km,0) actual_distance_km,
        d.full_name driver_full_name,d.phone driver_phone,d.vehicle_type driver_vehicle_type,d.vehicle_plate driver_vehicle_plate
      FROM bhuz_services s
      LEFT JOIN users u ON LOWER(u.email)=LOWER(s.customer_email)
      LEFT JOIN bhuz_delivery_jobs j ON j.source_type='PACKAGE' AND j.source_id=s.id
      LEFT JOIN travelled t ON t.delivery_job_id=j.id
      LEFT JOIN bhuz_drivers d ON d.id=COALESCE(j.driver_id,s.driver_id)
      ORDER BY s.created_at DESC LIMIT 500`);
    const services=result.rows.map(row=>({
      id:row.id,serviceType:row.service_type||'PACKAGE',customerEmail:row.customer_email||'',customerName:row.registered_sender_name||row.customer_name||'',customerPhone:row.registered_sender_phone||row.customer_phone||'',receiverName:row.receiver_name||'',receiverPhone:row.receiver_phone||'',pickupAddress:row.pickup_address||'',pickupReference:row.pickup_reference||'',deliveryAddress:row.delivery_address||'',deliveryReference:row.delivery_reference||'',packageDescription:row.package_description||'',packageSize:row.package_size||'',distanceKm:Number(row.distance_km||row.route_distance_km||0),routeDistanceKm:Number(row.route_distance_km||row.distance_km||0),actualDistanceKm:Number(row.actual_distance_km||0),totalAmount:Number(row.total_amount||0),paymentStatus:row.payment_status||'',paymentMethod:row.payment_method||'',status:row.status||'',driverId:row.job_driver_id||row.driver_id||'',driverName:row.driver_full_name||row.driver_name||'',driverPhone:row.driver_phone||'',driverVehicleType:row.driver_vehicle_type||'',driverVehiclePlate:row.driver_vehicle_plate||'',deliveryJobStatus:row.delivery_job_status||'',createdAt:row.created_at,updatedAt:row.updated_at,acceptedAt:row.assigned_at,pickedUpAt:row.picked_up_at,deliveredAt:row.delivered_at
    }));
    return res.json({ok:true,source:'postgres',services});
  } catch(error){console.error('Error cargando paquetes administrativos:',error.message);return res.status(500).json({ok:false,message:'No se pudieron cargar los paquetes.',error:error.message});}
});


  return router;
}

module.exports = crearRutasAdmin;

