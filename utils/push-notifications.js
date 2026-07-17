const webpush = require("web-push");

let configured = false;
let schemaPromise = null;

function configureWebPush() {
  if (configured) return true;
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(process.env.VAPID_SUBJECT || "mailto:soporte@bhuz.app").trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

async function ensurePushSchema(pool) {
  if (schemaPromise) return schemaPromise;
  schemaPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS bhuz_push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_email TEXT,
      service_id TEXT,
      order_id TEXT,
      device_name TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bhuz_push_user ON bhuz_push_subscriptions(user_email,active);
    CREATE INDEX IF NOT EXISTS idx_bhuz_push_service ON bhuz_push_subscriptions(service_id,active);
    CREATE INDEX IF NOT EXISTS idx_bhuz_push_order ON bhuz_push_subscriptions(order_id,active);
  `).catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}

async function saveSubscription(pool, body={}) {
  await ensurePushSchema(pool);
  const sub = body.subscription || body;
  const endpoint = String(sub.endpoint || "").trim();
  const p256dh = String(sub.keys?.p256dh || body.p256dh || "").trim();
  const auth = String(sub.keys?.auth || body.auth || "").trim();
  if (!endpoint || !p256dh || !auth) throw Object.assign(new Error("Suscripción push inválida"), {statusCode:400});
  await pool.query(`INSERT INTO bhuz_push_subscriptions(endpoint,p256dh,auth,user_email,service_id,order_id,device_name,active,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_email=COALESCE(EXCLUDED.user_email,bhuz_push_subscriptions.user_email),service_id=COALESCE(EXCLUDED.service_id,bhuz_push_subscriptions.service_id),order_id=COALESCE(EXCLUDED.order_id,bhuz_push_subscriptions.order_id),device_name=EXCLUDED.device_name,active=TRUE,updated_at=NOW()`,[
    endpoint,p256dh,auth,String(body.userEmail||'').trim().toLowerCase()||null,String(body.serviceId||'').trim()||null,String(body.orderId||'').trim()||null,String(body.deviceName||'').trim()||null
  ]);
}

async function removeSubscription(pool, endpoint) {
  await ensurePushSchema(pool);
  await pool.query(`UPDATE bhuz_push_subscriptions SET active=FALSE,updated_at=NOW() WHERE endpoint=$1`,[String(endpoint||'').trim()]);
}

async function sendWhere(pool, whereSql, params, payload) {
  if (!configureWebPush()) return {sent:0,skipped:true};
  await ensurePushSchema(pool);
  const rows=(await pool.query(`SELECT endpoint,p256dh,auth FROM bhuz_push_subscriptions WHERE active=TRUE AND (${whereSql})`,params)).rows;
  let sent=0;
  await Promise.all(rows.map(async row=>{
    try {
      await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload),{TTL:300,urgency:'high'});
      sent++;
    } catch(err) {
      if ([404,410].includes(err.statusCode)) await pool.query(`UPDATE bhuz_push_subscriptions SET active=FALSE,updated_at=NOW() WHERE endpoint=$1`,[row.endpoint]);
      else console.warn('BHUZ push:',err.message);
    }
  }));
  return {sent};
}

function sendOrderStatus(pool, order, title, message) {
  if(!order) return Promise.resolve({sent:0});
  const email=String(order.customer_email||order.customerEmail||order.customer?.email||'').trim().toLowerCase();
  return sendWhere(pool,`order_id=$1 OR ($2<>'' AND user_email=$2)`,[String(order.id||''),email],{title,body:message,url:`/mis-pedidos.html?order=${encodeURIComponent(order.id||'')}`,tag:`order-${order.id}`,type:'ORDER',id:order.id});
}
function sendServiceStatus(pool, service, title, message) {
  if(!service) return Promise.resolve({sent:0});
  const email=String(service.customer_email||service.customerEmail||'').trim().toLowerCase();
  return sendWhere(pool,`service_id=$1 OR ($2<>'' AND user_email=$2)`,[String(service.id||''),email],{title,body:message,url:`/?service=${encodeURIComponent(service.id||'')}#envios`,tag:`service-${service.id}`,type:'SERVICE',id:service.id});
}

module.exports={configureWebPush,ensurePushSchema,saveSubscription,removeSubscription,sendOrderStatus,sendServiceStatus};
