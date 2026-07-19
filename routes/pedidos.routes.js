const express = require("express");
const crypto = require("crypto");
const { verifyPassword, hashPassword } = require("../utils/passwords");
const { sendOrderStatus } = require("../utils/push-notifications");

const TRANSITIONS = {
  pendiente: ["aceptado", "cancelado"],
  aceptado: ["preparando", "cancelado"],
  preparando: ["listo", "cancelado"],
  listo: ["retirado"],
  retirado: ["en_camino"],
  en_camino: ["entregado"]
};
const RESTAURANT_STATES = new Set(["aceptado", "preparando", "listo", "retirado"]);
const DRIVER_STATES = new Set(["en_camino", "entregado"]);

function statusNotice(status, restaurantName="el restaurante") {
  const map = {
    aceptado: ["Pedido aceptado", `${restaurantName} aceptó tu pedido.`],
    preparando: ["Pedido en preparación", `${restaurantName} está preparando tu pedido.`],
    listo: ["Pedido listo", "Tu pedido está listo para ser retirado."],
    retirado: ["Pedido retirado", "El repartidor retiró tu pedido del local."],
    en_camino: ["Tu pedido va en camino", "El repartidor ya va hacia tu ubicación."],
    entregado: ["Pedido entregado", "Tu pedido fue entregado. ¡Buen provecho!"],
    cancelado: ["Pedido cancelado", "Tu pedido fue cancelado."]
  };
  return map[status] || ["Pedido actualizado", "Tu pedido cambió de estado."];
}

async function ensureCustomerDeliveryCodes(pool, orders = []) {
  for (const order of orders) {
    const status = String(order.status || "").toLowerCase();
    if (["entregado", "cancelado"].includes(status) || order.deliveryCode) continue;

    const code = String(crypto.randomInt(100000, 1000000));
    const hash = await hashPassword(code);
    const result = await pool.query(
      `UPDATE orders
       SET delivery_code_hash = COALESCE(delivery_code_hash, $2),
           delivery_code_plain = COALESCE(NULLIF(delivery_code_plain, ''), $3),
           delivery_code_attempts = COALESCE(delivery_code_attempts, 0),
           updated_at = NOW()
       WHERE id = $1
       RETURNING delivery_code_plain`,
      [order.id, hash, code]
    );
    order.deliveryCode = result.rows[0]?.delivery_code_plain || code;
  }
  return orders;
}

function crearRutasPedidos(dependencias) {
  const router = express.Router();
  const { pool, normalizeEmail, normalizeOrderStatus, createOrderInPostgres, getOrdersFromPostgres, getOrderByIdFromPostgres, authMiddleware } = dependencias;
  const { requireAuth, requireRole, requireOwnerEmail } = authMiddleware;

  router.post("/", ...requireRole("customer"), async (req, res) => {
    try {
      const trusted = req.auth.user;
      const body = { ...(req.body || {}), userId: trusted.id, customerEmail: trusted.email, customer: { ...(req.body?.customer || {}), email: trusted.email, fullName: trusted.fullName || trusted.name, phone: trusted.phone } };
      const newOrder = await createOrderInPostgres(body);
      return res.status(201).json({ ok:true, source:"postgres", message:"Pedido creado correctamente", order:newOrder });
    } catch (error) { return res.status(error.statusCode||500).json({ok:false,message:error.message||"Error creando pedido"}); }
  });

  router.get("/", ...requireRole("admin"), async (req,res)=>{
    try { const orders=(await getOrdersFromPostgres()).map(({deliveryCode,...order})=>order); return res.json(orders); }
    catch(error){ return res.status(500).json({ok:false,message:"Error leyendo pedidos"}); }
  });

  router.get("/me", ...requireRole("customer"), async(req,res)=>{
    const orders=await getOrdersFromPostgres({customerEmail:req.auth.user.email});
    await ensureCustomerDeliveryCodes(pool, orders);
    res.set("Cache-Control", "no-store");
    res.json({ok:true,source:"postgres",total:orders.length,orders});
  });

  router.get("/restaurant/me", ...requireRole("restaurant"), async(req,res)=>{
    const orders=(await getOrdersFromPostgres({restaurantEmail:req.auth.user.email})).map(({deliveryCode,...order})=>order);
    res.json({ok:true,source:"postgres",total:orders.length,orders});
  });

  // Compatibilidad temporal: se valida que el correo de la URL sea el de la sesión.
  router.get("/restaurant/:email", ...requireRole("restaurant"), requireOwnerEmail("email"), async(req,res)=>{
    const orders=(await getOrdersFromPostgres({restaurantEmail:req.auth.user.email})).map(({deliveryCode,...order})=>order);
    res.json({ok:true,source:"postgres",total:orders.length,orders});
  });
  router.get("/customer/:email", ...requireRole("customer"), requireOwnerEmail("email"), async(req,res)=>{
    const orders=await getOrdersFromPostgres({customerEmail:req.auth.user.email});
    await ensureCustomerDeliveryCodes(pool, orders);
    res.set("Cache-Control", "no-store");
    res.json({ok:true,source:"postgres",total:orders.length,orders});
  });

  router.patch("/:id/status", requireAuth, async (req,res)=>{
    const orderId=String(req.params.id||"").trim();
    const newStatus=normalizeOrderStatus(req.body?.status);
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const found=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[orderId]);
      const order=found.rows[0];
      if(!order){await client.query("ROLLBACK");return res.status(404).json({ok:false,message:"Pedido no encontrado"});}
      const current=normalizeOrderStatus(order.status);
      if(!(TRANSITIONS[current]||[]).includes(newStatus)){await client.query("ROLLBACK");return res.status(409).json({ok:false,message:`Transición no permitida: ${current} → ${newStatus}`});}
      const role=req.auth.role;
      if(RESTAURANT_STATES.has(newStatus)){
        if(role!=="restaurant" || normalizeEmail(req.auth.user.email)!==normalizeEmail(order.restaurant_email)){await client.query("ROLLBACK");return res.status(403).json({ok:false,message:"Solo el restaurante de este pedido puede cambiar ese estado."});}
      } else if(DRIVER_STATES.has(newStatus)) {
        if(role!=="driver" && role!=="admin"){await client.query("ROLLBACK");return res.status(403).json({ok:false,message:"Solo el repartidor asignado puede cambiar ese estado."});}
        if(role==="driver" && order.driver_id && String(order.driver_id)!==String(req.auth.user.id)){await client.query("ROLLBACK");return res.status(403).json({ok:false,message:"Este pedido pertenece a otro repartidor."});}
      } else if(newStatus==="cancelado" && !["customer","restaurant","admin"].includes(role)) {await client.query("ROLLBACK");return res.status(403).json({ok:false,message:"No autorizado."});}

      await client.query(`UPDATE orders SET status=$1, ready_at=CASE WHEN $1='listo' THEN COALESCE(ready_at,NOW()) ELSE ready_at END, picked_up_at=CASE WHEN $1='retirado' THEN COALESCE(picked_up_at,NOW()) ELSE picked_up_at END, updated_at=NOW() WHERE id=$2`,[newStatus,orderId]);
      await client.query("COMMIT");
      const updated=await getOrderByIdFromPostgres(orderId);
      const [title,message]=statusNotice(newStatus,updated.restaurantName);
      sendOrderStatus(pool,{...updated,customer_email:updated.customerEmail},title,message).catch(err=>console.warn("Push pedido:",err.message));
      res.json({ok:true,source:"postgres",message:"Estado actualizado correctamente",order:updated});
    } catch(error){await client.query("ROLLBACK");res.status(500).json({ok:false,message:"Error actualizando estado",error:error.message});}
    finally{client.release();}
  });

  router.post("/:id/confirm-delivery", ...requireRole("driver","admin"), async(req,res)=>{
    const orderId=String(req.params.id||"").trim();
    const code=String(req.body?.code||"").trim();
    if(!/^\d{6}$/.test(code)) return res.status(400).json({ok:false,message:"Ingresa el código de 6 dígitos."});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const q=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[orderId]);
      const order=q.rows[0];
      if(!order){await client.query("ROLLBACK");return res.status(404).json({ok:false,message:"Pedido no encontrado"});}
      if(normalizeOrderStatus(order.status)!=="en_camino"){await client.query("ROLLBACK");return res.status(409).json({ok:false,message:"El pedido todavía no está en camino."});}
      if(Number(order.delivery_code_attempts||0)>=5){await client.query("ROLLBACK");return res.status(423).json({ok:false,message:"Código bloqueado por demasiados intentos. Contacta al administrador."});}
      const valid=await verifyPassword(code,order.delivery_code_hash||"");
      if(!valid){await client.query(`UPDATE orders SET delivery_code_attempts=COALESCE(delivery_code_attempts,0)+1,updated_at=NOW() WHERE id=$1`,[orderId]);await client.query("COMMIT");return res.status(400).json({ok:false,message:"Código incorrecto."});}
      await client.query(`UPDATE orders SET status='entregado',delivery_code_verified_at=NOW(),delivered_by_driver_id=$2,updated_at=NOW() WHERE id=$1`,[orderId,req.auth.user.id||null]);
      await client.query("COMMIT");
      const updated=await getOrderByIdFromPostgres(orderId);
      sendOrderStatus(pool,{...updated,customer_email:updated.customerEmail},"Pedido entregado","Tu pedido fue entregado. ¡Buen provecho!").catch(()=>{});
      res.json({ok:true,message:"Entrega confirmada correctamente",order:updated});
    }catch(error){await client.query("ROLLBACK");res.status(500).json({ok:false,message:"No se pudo confirmar la entrega",error:error.message});}
    finally{client.release();}
  });

  return router;
}
module.exports=crearRutasPedidos;
