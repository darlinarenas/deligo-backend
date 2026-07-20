const express=require('express');
const {ensurePushSchema,saveSubscription,removeSubscription}=require('../utils/push-notifications');

module.exports=function crearRutasTracking({pool}){
  const r=express.Router();
  let schemaPromise=null;
  async function ensure(){
    if(schemaPromise)return schemaPromise;
    schemaPromise=Promise.all([
      ensurePushSchema(pool),
      pool.query(`CREATE TABLE IF NOT EXISTS bhuz_delivery_positions(
        id BIGSERIAL PRIMARY KEY,driver_id TEXT NOT NULL,delivery_job_id TEXT,
        latitude NUMERIC(10,7) NOT NULL,longitude NUMERIC(10,7) NOT NULL,
        accuracy NUMERIC(10,2),heading NUMERIC(10,2),speed NUMERIC(10,2),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
        CREATE INDEX IF NOT EXISTS idx_bhuz_positions_job_date ON bhuz_delivery_positions(delivery_job_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_bhuz_positions_driver_date ON bhuz_delivery_positions(driver_id,created_at DESC);`)
    ]).catch(e=>{schemaPromise=null;throw e});
    return schemaPromise;
  }
  r.get('/config',async(req,res)=>{try{await ensure();res.json({ok:true,vapidPublicKey:String(process.env.VAPID_PUBLIC_KEY||'')})}catch(e){res.status(500).json({ok:false,message:'No se pudo cargar la configuración.'})}});
  r.post('/subscriptions',async(req,res)=>{try{await saveSubscription(pool,req.body||{});res.status(201).json({ok:true})}catch(e){res.status(e.statusCode||500).json({ok:false,message:e.message||'No se pudo activar la notificación.'})}});
  r.delete('/subscriptions',async(req,res)=>{try{await removeSubscription(pool,req.body?.endpoint);res.json({ok:true})}catch(e){res.status(500).json({ok:false,message:'No se pudo desactivar la notificación.'})}});
  r.get('/live/:sourceType/:sourceId',async(req,res)=>{try{
    await ensure(); const type=String(req.params.sourceType||'').toUpperCase(); const sid=String(req.params.sourceId||'').trim();
    const job=(await pool.query(`SELECT j.*,d.full_name AS driver_name,d.vehicle_type,d.vehicle_color,d.vehicle_plate,d.last_latitude,d.last_longitude,d.last_location_at
      FROM bhuz_delivery_jobs j LEFT JOIN bhuz_drivers d ON d.id=j.driver_id WHERE j.source_type=$1 AND j.source_id=$2 LIMIT 1`,[type,sid])).rows[0];
    if(!job)return res.status(404).json({ok:false,message:'Todavía no hay un repartidor asignado.'});
    const pos=(await pool.query(`SELECT latitude,longitude,accuracy,heading,speed,created_at FROM bhuz_delivery_positions WHERE delivery_job_id=$1 ORDER BY created_at DESC LIMIT 1`,[job.id])).rows[0];
    res.json({ok:true,tracking:{jobId:job.id,sourceType:type,sourceId:sid,status:job.status,driver:{name:job.driver_name||'Repartidor BHUZ',vehicleType:job.vehicle_type,vehicleColor:job.vehicle_color,vehiclePlate:job.vehicle_plate},position:pos||((job.last_latitude&&job.last_longitude)?{latitude:job.last_latitude,longitude:job.last_longitude,created_at:job.last_location_at}:null),pickup:{latitude:job.pickup_latitude,longitude:job.pickup_longitude,address:job.pickup_address},delivery:{latitude:job.delivery_latitude,longitude:job.delivery_longitude,address:job.delivery_address},updatedAt:(pos&&pos.created_at)||job.last_location_at||job.updated_at}});
  }catch(e){console.error(e);res.status(500).json({ok:false,message:'No se pudo consultar el seguimiento.'})}});
  return r;
};
