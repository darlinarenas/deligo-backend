const express = require('express');
const crypto = require('crypto');

const id = (p='drv') => `${p}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
const email = v => String(v||'').trim().toLowerCase();
const num = (v,d=0) => Number.isFinite(Number(v)) ? Number(v) : d;

module.exports = function crearRutasDrivers({ pool }) {
  const r = express.Router();

  let schemaReadyPromise = null;
  async function ensureDriverSchema() {
    if (schemaReadyPromise) return schemaReadyPromise;
    schemaReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS bhuz_drivers (
        id TEXT PRIMARY KEY, user_id TEXT, full_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        password TEXT, phone TEXT, identity_document TEXT, birth_date DATE, address TEXT,
        country_code TEXT NOT NULL DEFAULT 'VE', city TEXT NOT NULL DEFAULT 'Punto Fijo', zone TEXT,
        vehicle_type TEXT DEFAULT 'Moto', vehicle_brand TEXT, vehicle_model TEXT, vehicle_plate TEXT,
        vehicle_color TEXT, emergency_contact TEXT, photo_url TEXT, vehicle_photo_url TEXT,
        license_url TEXT, vehicle_document_url TEXT,
        administrative_status TEXT NOT NULL DEFAULT 'PENDING', operational_status TEXT NOT NULL DEFAULT 'OFFLINE',
        is_available BOOLEAN NOT NULL DEFAULT FALSE, rating NUMERIC(3,2) NOT NULL DEFAULT 5,
        completed_deliveries INTEGER NOT NULL DEFAULT 0, acceptance_rate NUMERIC(5,2) NOT NULL DEFAULT 100,
        commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10, base_currency TEXT NOT NULL DEFAULT 'USD',
        last_latitude NUMERIC(10,7), last_longitude NUMERIC(10,7), last_location_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bhuz_delivery_jobs (
        id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, driver_id TEXT REFERENCES bhuz_drivers(id),
        assignment_mode TEXT NOT NULL DEFAULT 'OPEN', status TEXT NOT NULL DEFAULT 'PENDING_ASSIGNMENT', priority INTEGER NOT NULL DEFAULT 0,
        pickup_name TEXT, pickup_address TEXT, pickup_reference TEXT, pickup_latitude NUMERIC(10,7), pickup_longitude NUMERIC(10,7),
        delivery_name TEXT, delivery_address TEXT, delivery_reference TEXT, delivery_latitude NUMERIC(10,7), delivery_longitude NUMERIC(10,7),
        distance_km NUMERIC(10,2) NOT NULL DEFAULT 0, service_total NUMERIC(14,2) NOT NULL DEFAULT 0,
        driver_earning NUMERIC(14,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', payment_method TEXT,
        payment_received_by TEXT, estimated_pickup_at TIMESTAMPTZ, assigned_at TIMESTAMPTZ, picked_up_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bhuz_jobs_source ON bhuz_delivery_jobs(source_type, source_id);
      CREATE TABLE IF NOT EXISTS bhuz_driver_ledger (
        id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
        delivery_job_id TEXT REFERENCES bhuz_delivery_jobs(id), movement_type TEXT NOT NULL,
        direction TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
        exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1, base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        base_currency TEXT NOT NULL DEFAULT 'USD', description TEXT, settlement_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bhuz_driver_settlements (
        id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
        period_from TIMESTAMPTZ NOT NULL, period_to TIMESTAMPTZ NOT NULL, cutoff_mode TEXT NOT NULL DEFAULT 'CUSTOM',
        country_code TEXT NOT NULL DEFAULT 'VE', currency TEXT NOT NULL DEFAULT 'USD', exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
        total_jobs INTEGER NOT NULL DEFAULT 0, service_total NUMERIC(14,2) NOT NULL DEFAULT 0,
        driver_earnings NUMERIC(14,2) NOT NULL DEFAULT 0, cash_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
        digital_collected NUMERIC(14,2) NOT NULL DEFAULT 0, tips NUMERIC(14,2) NOT NULL DEFAULT 0,
        bonuses NUMERIC(14,2) NOT NULL DEFAULT 0, penalties NUMERIC(14,2) NOT NULL DEFAULT 0,
        driver_owes_bhuz NUMERIC(14,2) NOT NULL DEFAULT 0, bhuz_owes_driver NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_balance NUMERIC(14,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PENDING', notes TEXT,
        proof_url TEXT, created_by TEXT, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bhuz_driver_incidents (
        id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
        delivery_job_id TEXT REFERENCES bhuz_delivery_jobs(id), incident_type TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN', evidence_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
      );
      ALTER TABLE bhuz_services ADD COLUMN IF NOT EXISTS driver_earning NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_services ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS assignment_mode TEXT NOT NULL DEFAULT 'OPEN';
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING_ASSIGNMENT';
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS pickup_name TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS pickup_address TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS pickup_reference TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS pickup_latitude NUMERIC(10,7);
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS pickup_longitude NUMERIC(10,7);
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS delivery_name TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS delivery_address TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS delivery_reference TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(10,7);
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(10,7);
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS service_total NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS driver_earning NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS payment_method TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS payment_received_by TEXT;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS estimated_pickup_at TIMESTAMPTZ;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
      ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE bhuz_driver_ledger ADD COLUMN IF NOT EXISTS base_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_driver_ledger ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'USD';
      ALTER TABLE bhuz_driver_ledger ADD COLUMN IF NOT EXISTS settlement_id TEXT;
      ALTER TABLE bhuz_driver_settlements ADD COLUMN IF NOT EXISTS net_balance NUMERIC(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE bhuz_driver_settlements ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
      CREATE TABLE IF NOT EXISTS bhuz_driver_settlement_requests (
        id TEXT PRIMARY KEY,
        driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
        requested_mode TEXT NOT NULL DEFAULT 'WEEKLY',
        note TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by TEXT
      );
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_id TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'NOT_REQUIRED';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_earning NUMERIC(14,2) DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS assignment_mode TEXT DEFAULT 'OPEN';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_job_id TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_bhuz_jobs_driver_status ON bhuz_delivery_jobs(driver_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bhuz_jobs_open ON bhuz_delivery_jobs(status,priority DESC,created_at);
      CREATE INDEX IF NOT EXISTS idx_bhuz_ledger_driver_date ON bhuz_driver_ledger(driver_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bhuz_settlements_driver_date ON bhuz_driver_settlements(driver_id,period_to DESC);
    `).catch(err => { schemaReadyPromise = null; throw err; });
    return schemaReadyPromise;
  }

  const mapDriver = x => x ? ({
    id:x.id, userId:x.user_id, fullName:x.full_name, email:x.email, phone:x.phone,
    identityDocument:x.identity_document, address:x.address, countryCode:x.country_code,
    city:x.city, zone:x.zone, vehicleType:x.vehicle_type, vehicleBrand:x.vehicle_brand,
    vehicleModel:x.vehicle_model, vehiclePlate:x.vehicle_plate, vehicleColor:x.vehicle_color,
    administrativeStatus:x.administrative_status, operationalStatus:x.operational_status,
    isAvailable:x.is_available, rating:Number(x.rating||0), completedDeliveries:Number(x.completed_deliveries||0),
    acceptanceRate:Number(x.acceptance_rate||0), commissionPercent:Number(x.commission_percent||10),
    baseCurrency:x.base_currency, lastLatitude:x.last_latitude, lastLongitude:x.last_longitude,
    lastSeenAt:x.last_seen_at, createdAt:x.created_at
  }) : null;

  async function ensureDriver(driverId, body={}) {
    const found = await pool.query('SELECT * FROM bhuz_drivers WHERE id=$1',[driverId]);
    if (found.rows[0]) return found.rows[0];
    const cleanEmail=email(body.email || `${driverId}@legacy.bhuz.local`);
    const q=await pool.query(`INSERT INTO bhuz_drivers(id,user_id,full_name,email,phone,city,zone,vehicle_type,administrative_status,operational_status,is_available,last_seen_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'APPROVED','AVAILABLE',TRUE,NOW()) RETURNING *`,[
      driverId,body.userId||null,body.fullName||body.name||'Repartidor BHUZ',cleanEmail,body.phone||'',body.city||'Punto Fijo',body.zone||'Punto Fijo',body.vehicleType||'Moto']);
    return q.rows[0];
  }

  r.post('/register', async(req,res)=>{
    try {
      await ensureDriverSchema();
      const b=req.body||{}; const e=email(b.email);
      if(!b.fullName||!e||!b.password||!b.phone) return res.status(400).json({ok:false,message:'Nombre, correo, contraseña y teléfono son obligatorios.'});
      const exists=await pool.query('SELECT id FROM bhuz_drivers WHERE LOWER(email)=LOWER($1)',[e]);
      if(exists.rows[0]) return res.status(409).json({ok:false,message:'Ya existe un repartidor con ese correo.'});
      const driverId=id('driver');
      const q=await pool.query(`INSERT INTO bhuz_drivers(id,full_name,email,password,phone,identity_document,address,country_code,city,zone,vehicle_type,vehicle_brand,vehicle_model,vehicle_plate,vehicle_color,emergency_contact,administrative_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'PENDING') RETURNING *`,[driverId,b.fullName,e,String(b.password),b.phone,b.identityDocument||null,b.address||null,b.countryCode||'VE',b.city||'Punto Fijo',b.zone||null,b.vehicleType||'Moto',b.vehicleBrand||null,b.vehicleModel||null,b.vehiclePlate||null,b.vehicleColor||null,b.emergencyContact||null]);
      res.status(201).json({ok:true,driver:mapDriver(q.rows[0]),message:'Registro creado. Pendiente de aprobación.'});
    } catch(err){ console.error(err); res.status(500).json({ok:false,message:'No se pudo registrar el repartidor.'}); }
  });

  r.post('/login', async(req,res)=>{
    try { await ensureDriverSchema(); const e=email(req.body?.email); const p=String(req.body?.password||'');
      const q=await pool.query('SELECT * FROM bhuz_drivers WHERE LOWER(email)=LOWER($1)',[e]); const d=q.rows[0];
      if(!d || String(d.password||'')!==p) return res.status(401).json({ok:false,message:'Credenciales incorrectas.'});
      if(d.administrative_status==='PENDING') return res.status(403).json({ok:false,message:'Tu cuenta está pendiente de aprobación administrativa.'});
      if(['BLOCKED','REJECTED','SUSPENDED'].includes(d.administrative_status)) return res.status(403).json({ok:false,message:`Cuenta ${d.administrative_status.toLowerCase()}.`});
      await pool.query('UPDATE bhuz_drivers SET last_seen_at=NOW(),updated_at=NOW() WHERE id=$1',[d.id]);
      res.json({ok:true,driver:mapDriver(d)});
    } catch(err){res.status(500).json({ok:false,message:'No se pudo iniciar sesión.'});}
  });

  r.post('/:driverId/bootstrap', async(req,res)=>{ try { const d=await ensureDriver(req.params.driverId,req.body); res.json({ok:true,driver:mapDriver(d)}); } catch(err){res.status(500).json({ok:false,message:'No se pudo preparar el perfil.'});} });

  r.get('/:driverId/dashboard', async(req,res)=>{
    try {
      await ensureDriverSchema();
      const driver=await ensureDriver(req.params.driverId,{});
      // La sincronización de paquetes no debe impedir que el repartidor abra su panel.
      try {
        await pool.query(`INSERT INTO bhuz_delivery_jobs(id,source_type,source_id,status,pickup_name,pickup_address,pickup_reference,pickup_latitude,pickup_longitude,delivery_name,delivery_address,delivery_reference,delivery_latitude,delivery_longitude,distance_km,service_total,driver_earning,currency,payment_method,payment_received_by)
          SELECT 'job_'||s.id,'PACKAGE',s.id,'PENDING_ASSIGNMENT',COALESCE(s.customer_name,'Retiro de paquete'),s.pickup_address,s.pickup_reference,s.pickup_latitude,s.pickup_longitude,s.receiver_name,s.delivery_address,s.delivery_reference,s.delivery_latitude,s.delivery_longitude,s.distance_km,s.total_amount,CASE WHEN COALESCE(s.driver_earning,0)>0 THEN s.driver_earning ELSE ROUND(COALESCE(s.total_amount,0)::numeric*0.10,2) END,COALESCE(s.currency,'USD'),s.payment_method,'BHUZ'
          FROM bhuz_services s WHERE s.status='SEARCHING_DRIVER'
          ON CONFLICT(source_type,source_id) DO NOTHING`);
      } catch (syncError) {
        console.warn('Sincronización de paquetes omitida:', syncError.message);
      }
      const [active,open,history,ledger,settlements,requests,stats]=await Promise.all([
        pool.query(`SELECT * FROM bhuz_delivery_jobs WHERE driver_id=$1 AND status NOT IN ('DELIVERED','CANCELLED') ORDER BY created_at DESC LIMIT 1`,[driver.id]),
        pool.query(`SELECT * FROM bhuz_delivery_jobs WHERE driver_id IS NULL AND status='PENDING_ASSIGNMENT' ORDER BY priority DESC,created_at ASC LIMIT 30`),
        pool.query(`SELECT * FROM bhuz_delivery_jobs WHERE driver_id=$1 AND status IN ('DELIVERED','CANCELLED') ORDER BY COALESCE(delivered_at,updated_at) DESC LIMIT 100`,[driver.id]),
        pool.query(`SELECT * FROM bhuz_driver_ledger WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 100`,[driver.id]),
        pool.query(`SELECT * FROM bhuz_driver_settlements WHERE driver_id=$1 ORDER BY period_to DESC LIMIT 30`,[driver.id]),
        pool.query(`SELECT * FROM bhuz_driver_settlement_requests WHERE driver_id=$1 ORDER BY requested_at DESC LIMIT 20`,[driver.id]),
        pool.query(`SELECT COUNT(*) FILTER (WHERE status='DELIVERED' AND delivered_at::date=CURRENT_DATE)::int deliveries_today,
          COALESCE(SUM(driver_earning) FILTER (WHERE status='DELIVERED' AND delivered_at::date=CURRENT_DATE),0) earnings_today,
          COALESCE(SUM(distance_km) FILTER (WHERE status='DELIVERED' AND delivered_at::date=CURRENT_DATE),0) km_today,
          COUNT(*) FILTER (WHERE status='DELIVERED' AND delivered_at>=date_trunc('week',NOW()))::int deliveries_week,
          COALESCE(SUM(driver_earning) FILTER (WHERE status='DELIVERED' AND delivered_at>=date_trunc('week',NOW())),0) earnings_week
          FROM bhuz_delivery_jobs WHERE driver_id=$1`,[driver.id])
      ]);
      const balance=ledger.rows.reduce((a,m)=>a+(m.direction==='CREDIT_DRIVER'?num(m.base_amount||m.amount):-num(m.base_amount||m.amount)),0);
      res.json({ok:true,driver:mapDriver(driver),activeJob:active.rows[0]||null,availableJobs:open.rows,history:history.rows,ledger:ledger.rows,settlements:settlements.rows,settlementRequests:requests.rows,stats:{...stats.rows[0],balance}});
    } catch(err){console.error(err);res.status(500).json({ok:false,message:'No se pudo cargar el panel del repartidor.',detail:err.message});}
  });

  r.patch('/:driverId/availability', async(req,res)=>{
    try { const available=!!req.body?.available; const op=available?'AVAILABLE':'OFFLINE';
      const q=await pool.query(`UPDATE bhuz_drivers SET is_available=$2,operational_status=$3,last_seen_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.driverId,available,op]);
      if(!q.rows[0]) return res.status(404).json({ok:false,message:'Repartidor no encontrado.'}); res.json({ok:true,driver:mapDriver(q.rows[0])});
    } catch(err){res.status(500).json({ok:false,message:'No se pudo cambiar la disponibilidad.'});}
  });

  r.patch('/:driverId/profile', async(req,res)=>{
    try { const b=req.body||{}; const q=await pool.query(`UPDATE bhuz_drivers SET full_name=COALESCE(NULLIF($2,''),full_name),phone=COALESCE(NULLIF($3,''),phone),address=COALESCE(NULLIF($4,''),address),country_code=COALESCE(NULLIF($5,''),country_code),city=COALESCE(NULLIF($6,''),city),zone=COALESCE(NULLIF($7,''),zone),vehicle_type=COALESCE(NULLIF($8,''),vehicle_type),vehicle_brand=COALESCE(NULLIF($9,''),vehicle_brand),vehicle_model=COALESCE(NULLIF($10,''),vehicle_model),vehicle_plate=COALESCE(NULLIF($11,''),vehicle_plate),vehicle_color=COALESCE(NULLIF($12,''),vehicle_color),updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.driverId,b.fullName||'',b.phone||'',b.address||'',b.countryCode||'',b.city||'',b.zone||'',b.vehicleType||'',b.vehicleBrand||'',b.vehicleModel||'',b.vehiclePlate||'',b.vehicleColor||'']);
      res.json({ok:true,driver:mapDriver(q.rows[0])});
    } catch(err){res.status(500).json({ok:false,message:'No se pudo actualizar el perfil.'});}
  });

  r.post('/:driverId/location', async(req,res)=>{ try { await pool.query(`UPDATE bhuz_drivers SET last_latitude=$2,last_longitude=$3,last_location_at=NOW(),last_seen_at=NOW() WHERE id=$1`,[req.params.driverId,req.body?.latitude||null,req.body?.longitude||null]); res.json({ok:true}); } catch(err){res.status(500).json({ok:false,message:'No se pudo guardar la ubicación.'});} });

  r.post('/:driverId/jobs/:jobId/accept', async(req,res)=>{
    const client=await pool.connect(); try { await client.query('BEGIN');
      const job=(await client.query(`SELECT * FROM bhuz_delivery_jobs WHERE id=$1 FOR UPDATE`,[req.params.jobId])).rows[0];
      if(!job||job.status!=='PENDING_ASSIGNMENT'||job.driver_id) {await client.query('ROLLBACK');return res.status(409).json({ok:false,message:'La tarea ya no está disponible.'});}
      const active=(await client.query(`SELECT id FROM bhuz_delivery_jobs WHERE driver_id=$1 AND status NOT IN ('DELIVERED','CANCELLED') LIMIT 1`,[req.params.driverId])).rows[0];
      if(active){await client.query('ROLLBACK');return res.status(409).json({ok:false,message:'Ya tienes una entrega activa.'});}
      const q=await client.query(`UPDATE bhuz_delivery_jobs SET driver_id=$2,status='ASSIGNED',assigned_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[job.id,req.params.driverId]);
      await client.query(`UPDATE bhuz_drivers SET operational_status='ASSIGNED',is_available=FALSE,updated_at=NOW() WHERE id=$1`,[req.params.driverId]);
      if(job.source_type==='PACKAGE') await client.query(`UPDATE bhuz_services SET driver_id=$2,status='DRIVER_ASSIGNED',driver_earning=$3,updated_at=NOW() WHERE id=$1`,[job.source_id,req.params.driverId,job.driver_earning]);
      if(job.source_type==='FOOD_ORDER') await client.query(`UPDATE orders SET driver_id=$2,delivery_status='ASSIGNED',delivery_job_id=$3,driver_earning=$4,updated_at=NOW() WHERE id=$1`,[job.source_id,req.params.driverId,job.id,job.driver_earning]);
      await client.query('COMMIT'); res.json({ok:true,job:q.rows[0]});
    } catch(err){await client.query('ROLLBACK');console.error(err);res.status(500).json({ok:false,message:'No se pudo aceptar la tarea.'});} finally{client.release();}
  });

  r.patch('/:driverId/jobs/:jobId/status', async(req,res)=>{
    const next=String(req.body?.status||'').toUpperCase();
    const allowed={ASSIGNED:['GOING_TO_PICKUP'],GOING_TO_PICKUP:['ARRIVED_AT_PICKUP','PICKED_UP'],ARRIVED_AT_PICKUP:['PICKED_UP'],PICKED_UP:['GOING_TO_DELIVERY'],GOING_TO_DELIVERY:['ARRIVED_AT_DELIVERY','DELIVERED'],ARRIVED_AT_DELIVERY:['DELIVERED']};
    const client=await pool.connect(); try {await client.query('BEGIN'); const job=(await client.query('SELECT * FROM bhuz_delivery_jobs WHERE id=$1 AND driver_id=$2 FOR UPDATE',[req.params.jobId,req.params.driverId])).rows[0];
      if(!job) throw new Error('Tarea no encontrada.'); if(!(allowed[job.status]||[]).includes(next)) { await client.query('ROLLBACK'); return res.status(409).json({ok:false,message:`Transición inválida: ${job.status} → ${next}`}); }
      const delivered=next==='DELIVERED'; const q=await client.query(`UPDATE bhuz_delivery_jobs SET status=$3,picked_up_at=CASE WHEN $3='PICKED_UP' THEN NOW() ELSE picked_up_at END,delivered_at=CASE WHEN $3='DELIVERED' THEN NOW() ELSE delivered_at END,updated_at=NOW() WHERE id=$1 AND driver_id=$2 RETURNING *`,[job.id,req.params.driverId,next]);
      if(job.source_type==='PACKAGE') { const sm={GOING_TO_PICKUP:'GOING_TO_PICKUP',PICKED_UP:'PACKAGE_PICKED',GOING_TO_DELIVERY:'GOING_TO_DELIVERY',DELIVERED:'DELIVERED'}; if(sm[next]) await client.query('UPDATE bhuz_services SET status=$2,updated_at=NOW() WHERE id=$1',[job.source_id,sm[next]]); }
      if(job.source_type==='FOOD_ORDER') await client.query('UPDATE orders SET delivery_status=$2,status=CASE WHEN $2=\'DELIVERED\' THEN \'entregado\' ELSE status END,updated_at=NOW() WHERE id=$1',[job.source_id,next]);
      if(delivered){
        await client.query(`INSERT INTO bhuz_driver_ledger(id,driver_id,delivery_job_id,movement_type,direction,amount,currency,base_amount,base_currency,description) VALUES($1,$2,$3,'EARNING','CREDIT_DRIVER',$4,$5,$4,$5,$6)`,[id('mov'),req.params.driverId,job.id,num(job.driver_earning),job.currency||'USD',`Ganancia por entrega ${job.id}`]);
        if(job.payment_received_by==='DRIVER') await client.query(`INSERT INTO bhuz_driver_ledger(id,driver_id,delivery_job_id,movement_type,direction,amount,currency,base_amount,base_currency,description) VALUES($1,$2,$3,'CASH_COLLECTED','DEBIT_DRIVER',$4,$5,$4,$5,$6)`,[id('mov'),req.params.driverId,job.id,num(job.service_total),job.currency||'USD',`Efectivo cobrado en ${job.id}`]);
        await client.query(`UPDATE bhuz_drivers SET operational_status='AVAILABLE',is_available=TRUE,completed_deliveries=completed_deliveries+1,updated_at=NOW() WHERE id=$1`,[req.params.driverId]);
      }
      await client.query('COMMIT');res.json({ok:true,job:q.rows[0]});
    } catch(err){await client.query('ROLLBACK');console.error(err);res.status(500).json({ok:false,message:err.message||'No se pudo cambiar el estado.'});} finally{client.release();}
  });

  r.post('/:driverId/incidents', async(req,res)=>{ try { const q=await pool.query(`INSERT INTO bhuz_driver_incidents(id,driver_id,delivery_job_id,incident_type,description,evidence_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[id('inc'),req.params.driverId,req.body?.jobId||null,req.body?.incidentType||'OTHER',req.body?.description||'',req.body?.evidenceUrl||null]);res.status(201).json({ok:true,incident:q.rows[0]}); }catch(err){res.status(500).json({ok:false,message:'No se pudo registrar la incidencia.'});} });

  r.post('/:driverId/settlement-requests', async(req,res)=>{
    try {
      await ensureDriverSchema();
      const driver=(await pool.query('SELECT id FROM bhuz_drivers WHERE id=$1',[req.params.driverId])).rows[0];
      if(!driver) return res.status(404).json({ok:false,message:'Repartidor no encontrado.'});
      const pending=(await pool.query(`SELECT * FROM bhuz_driver_settlement_requests WHERE driver_id=$1 AND status='PENDING' ORDER BY requested_at DESC LIMIT 1`,[driver.id])).rows[0];
      if(pending) return res.status(409).json({ok:false,message:'Ya tienes una solicitud de cierre pendiente.',request:pending});
      const q=await pool.query(`INSERT INTO bhuz_driver_settlement_requests(id,driver_id,requested_mode,note,status) VALUES($1,$2,$3,$4,'PENDING') RETURNING *`,[id('settle_req'),driver.id,'WEEKLY',String(req.body?.note||'').trim()||null]);
      res.status(201).json({ok:true,message:'Solicitud de cierre enviada al administrador.',request:q.rows[0]});
    } catch(err){console.error(err);res.status(500).json({ok:false,message:'No se pudo solicitar el cierre.'});}
  });

  r.post('/:driverId/settlements/preview', async(req,res)=>{
    try { const from=req.body?.from||'1970-01-01'; const to=req.body?.to||new Date().toISOString(); const rate=Math.max(num(req.body?.exchangeRate,1),0.00000001); const currency=req.body?.currency||'USD';
      const q=await pool.query(`SELECT COUNT(DISTINCT j.id)::int total_jobs,COALESCE(SUM(j.service_total),0) service_total,COALESCE(SUM(j.driver_earning),0) driver_earnings,COALESCE(SUM(j.service_total) FILTER(WHERE j.payment_received_by='DRIVER'),0) cash_collected,COALESCE(SUM(j.service_total) FILTER(WHERE j.payment_received_by='BHUZ'),0) digital_collected FROM bhuz_delivery_jobs j WHERE j.driver_id=$1 AND j.status='DELIVERED' AND j.delivered_at BETWEEN $2 AND $3 AND NOT EXISTS(SELECT 1 FROM bhuz_driver_ledger l WHERE l.delivery_job_id=j.id AND l.settlement_id IS NOT NULL)`,[req.params.driverId,from,to]); const x=q.rows[0];
      const driverOwes=Math.max(0,num(x.cash_collected)-num(x.driver_earnings)); const bhuzOwes=Math.max(0,num(x.driver_earnings)-num(x.cash_collected));
      res.json({ok:true,preview:{...x,driver_owes_bhuz:driverOwes,bhuz_owes_driver:bhuzOwes,net_balance:bhuzOwes-driverOwes,currency,exchangeRate:rate,from,to}});
    }catch(err){res.status(500).json({ok:false,message:'No se pudo calcular el cierre.'});}
  });

  r.post('/:driverId/settlements', async(req,res)=>{
    const client=await pool.connect(); try {await client.query('BEGIN'); const b=req.body||{}; const from=b.from; const to=b.to||new Date().toISOString(); if(!from) return res.status(400).json({ok:false,message:'Debes indicar el inicio del período.'});
      const q=await client.query(`SELECT COUNT(DISTINCT j.id)::int total_jobs,COALESCE(SUM(j.service_total),0) service_total,COALESCE(SUM(j.driver_earning),0) driver_earnings,COALESCE(SUM(j.service_total) FILTER(WHERE j.payment_received_by='DRIVER'),0) cash_collected,COALESCE(SUM(j.service_total) FILTER(WHERE j.payment_received_by='BHUZ'),0) digital_collected FROM bhuz_delivery_jobs j WHERE j.driver_id=$1 AND j.status='DELIVERED' AND j.delivered_at BETWEEN $2 AND $3 AND NOT EXISTS(SELECT 1 FROM bhuz_driver_ledger l WHERE l.delivery_job_id=j.id AND l.settlement_id IS NOT NULL)`,[req.params.driverId,from,to]); const x=q.rows[0]; const sid=id('settlement'); const owes=Math.max(0,num(x.cash_collected)-num(x.driver_earnings)); const owed=Math.max(0,num(x.driver_earnings)-num(x.cash_collected));
      const ins=await client.query(`INSERT INTO bhuz_driver_settlements(id,driver_id,period_from,period_to,cutoff_mode,country_code,currency,exchange_rate,total_jobs,service_total,driver_earnings,cash_collected,digital_collected,driver_owes_bhuz,bhuz_owes_driver,net_balance,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'PENDING',$17,$18) RETURNING *`,[sid,req.params.driverId,from,to,b.cutoffMode||'CUSTOM',b.countryCode||'VE',b.currency||'USD',num(b.exchangeRate,1),x.total_jobs,x.service_total,x.driver_earnings,x.cash_collected,x.digital_collected,owes,owed,owed-owes,b.notes||'',b.createdBy||req.params.driverId]);
      await client.query(`UPDATE bhuz_driver_ledger SET settlement_id=$1 WHERE driver_id=$2 AND created_at BETWEEN $3 AND $4 AND settlement_id IS NULL`,[sid,req.params.driverId,from,to]); await client.query('COMMIT');res.status(201).json({ok:true,settlement:ins.rows[0]});
    }catch(err){await client.query('ROLLBACK');console.error(err);res.status(500).json({ok:false,message:'No se pudo crear el cierre.'});}finally{client.release();}
  });

  r.post('/sync/package/:serviceId', async(req,res)=>{
    try { const s=(await pool.query('SELECT * FROM bhuz_services WHERE id=$1',[req.params.serviceId])).rows[0]; if(!s)return res.status(404).json({ok:false,message:'Servicio no encontrado.'});
      const earning=num(s.driver_earning)||Math.round(num(s.total_amount)*0.10*100)/100; const q=await pool.query(`INSERT INTO bhuz_delivery_jobs(id,source_type,source_id,status,pickup_name,pickup_address,pickup_reference,pickup_latitude,pickup_longitude,delivery_name,delivery_address,delivery_reference,delivery_latitude,delivery_longitude,distance_km,service_total,driver_earning,currency,payment_method,payment_received_by)
      VALUES($1,'PACKAGE',$2,'PENDING_ASSIGNMENT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(source_type,source_id) DO UPDATE SET pickup_address=EXCLUDED.pickup_address,delivery_address=EXCLUDED.delivery_address,distance_km=EXCLUDED.distance_km,service_total=EXCLUDED.service_total,driver_earning=EXCLUDED.driver_earning,updated_at=NOW() RETURNING *`,[id('job'),s.id,s.customer_name||'Retiro de paquete',s.pickup_address,s.pickup_reference,s.pickup_latitude,s.pickup_longitude,s.receiver_name,s.delivery_address,s.delivery_reference,s.delivery_latitude,s.delivery_longitude,s.distance_km,s.total_amount,earning,s.currency||'USD',s.payment_method||'',req.body?.paymentReceivedBy||'BHUZ']);res.json({ok:true,job:q.rows[0]});
    }catch(err){console.error(err);res.status(500).json({ok:false,message:'No se pudo sincronizar el paquete.'});}
  });

  r.post('/sync/order/:orderId', async(req,res)=>{
    try { const o=(await pool.query('SELECT * FROM orders WHERE id=$1',[req.params.orderId])).rows[0]; if(!o)return res.status(404).json({ok:false,message:'Pedido no encontrado.'}); const earning=num(req.body?.driverEarning,Math.max(1.5,num(o.total)*0.10));
      const q=await pool.query(`INSERT INTO bhuz_delivery_jobs(id,source_type,source_id,status,pickup_name,pickup_address,delivery_name,delivery_address,delivery_reference,delivery_latitude,delivery_longitude,service_total,driver_earning,currency,payment_method,payment_received_by,estimated_pickup_at)
      VALUES($1,'FOOD_ORDER',$2,'PENDING_ASSIGNMENT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(source_type,source_id) DO UPDATE SET status=CASE WHEN bhuz_delivery_jobs.status IN ('DELIVERED','CANCELLED') THEN bhuz_delivery_jobs.status ELSE 'PENDING_ASSIGNMENT' END,updated_at=NOW() RETURNING *`,[id('job'),o.id,o.restaurant_name||'Restaurante',req.body?.restaurantAddress||'',o.customer_name||'Cliente',o.delivery_address||o.customer_address,o.delivery_reference,o.latitude,o.longitude,o.total,earning,req.body?.currency||'USD',o.payment_method||'',req.body?.paymentReceivedBy||'BHUZ',req.body?.estimatedPickupAt||null]);
      await pool.query(`UPDATE orders SET delivery_status='PENDING_ASSIGNMENT',delivery_job_id=$2,driver_earning=$3,updated_at=NOW() WHERE id=$1`,[o.id,q.rows[0].id,earning]);res.json({ok:true,job:q.rows[0]});
    }catch(err){console.error(err);res.status(500).json({ok:false,message:'No se pudo crear la tarea del pedido.'});}
  });

  return r;
};
