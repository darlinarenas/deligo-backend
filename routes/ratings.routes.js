const express = require("express");
const crypto = require("crypto");

module.exports = function crearRutasRatings({ pool }) {
  const router = express.Router();
  const makeId = () => `rating_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const text = (v) => String(v ?? "").trim();
  const score = (v) => { const n=Number(v); return Number.isInteger(n) && n>=1 && n<=5 ? n : null; };

  router.post("/", async (req, res) => {
    const b=req.body||{};
    const sourceType=text(b.sourceType).toUpperCase();
    const sourceId=text(b.sourceId);
    const userEmail=text(b.userEmail).toLowerCase();
    if(!["PACKAGE","FOOD_ORDER"].includes(sourceType) || !sourceId || !userEmail) {
      return res.status(400).json({ok:false,message:"Faltan los datos del servicio o del usuario."});
    }
    const driverRating=score(b.driverRating);
    const restaurantRating=score(b.restaurantRating);
    if(!driverRating && !restaurantRating) return res.status(400).json({ok:false,message:"Debes indicar al menos una calificación."});
    try {
      let driverId=text(b.driverId)||null, restaurantId=text(b.restaurantId)||null;
      if(sourceType==='PACKAGE') {
        const q=await pool.query(`SELECT COALESCE(j.driver_id,s.driver_id) driver_id FROM bhuz_services s LEFT JOIN bhuz_delivery_jobs j ON j.source_type='PACKAGE' AND j.source_id=s.id WHERE s.id=$1`,[sourceId]);
        driverId=driverId||q.rows[0]?.driver_id||null;
      } else {
        const q=await pool.query(`SELECT COALESCE(j.driver_id,o.driver_id) driver_id, COALESCE(o.restaurant_id,o.restaurant_email) restaurant_id FROM orders o LEFT JOIN bhuz_delivery_jobs j ON j.source_type='FOOD_ORDER' AND j.source_id=o.id WHERE o.id=$1`,[sourceId]);
        driverId=driverId||q.rows[0]?.driver_id||null; restaurantId=restaurantId||q.rows[0]?.restaurant_id||null;
      }
      const q=await pool.query(`INSERT INTO bhuz_ratings(id,user_id,user_email,source_type,source_id,driver_id,restaurant_id,driver_rating,restaurant_rating,driver_comment,restaurant_comment,general_comment)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(user_email,source_type,source_id) DO UPDATE SET driver_rating=EXCLUDED.driver_rating,restaurant_rating=EXCLUDED.restaurant_rating,driver_comment=EXCLUDED.driver_comment,restaurant_comment=EXCLUDED.restaurant_comment,general_comment=EXCLUDED.general_comment,updated_at=NOW()
        RETURNING *`,[makeId(),text(b.userId)||null,userEmail,sourceType,sourceId,driverId,restaurantId,driverRating,restaurantRating,text(b.driverComment)||null,text(b.restaurantComment)||null,text(b.comment)||null]);
      if(driverId) await pool.query(`UPDATE bhuz_drivers d SET rating=COALESCE((SELECT ROUND(AVG(driver_rating)::numeric,2) FROM bhuz_ratings WHERE driver_id=d.id AND driver_rating IS NOT NULL),d.rating),updated_at=NOW() WHERE d.id=$1`,[driverId]);
      if(restaurantId) await pool.query(`UPDATE restaurants r SET rating=COALESCE((SELECT ROUND(AVG(restaurant_rating)::numeric,2)::text FROM bhuz_ratings WHERE restaurant_id IN (r.id,r.email) AND restaurant_rating IS NOT NULL),r.rating),updated_at=NOW() WHERE r.id=$1 OR LOWER(r.email)=LOWER($1)`,[restaurantId]);
      return res.status(201).json({ok:true,message:"Calificación guardada correctamente.",rating:q.rows[0]});
    } catch(error) { console.error('Error guardando calificación:',error.message); return res.status(500).json({ok:false,message:"No se pudo guardar la calificación."}); }
  });

  router.get("/service/:type/:id", async(req,res)=>{
    try { const q=await pool.query(`SELECT * FROM bhuz_ratings WHERE source_type=$1 AND source_id=$2 ORDER BY created_at DESC`,[text(req.params.type).toUpperCase(),text(req.params.id)]); res.json({ok:true,ratings:q.rows}); }
    catch(error){res.status(500).json({ok:false,message:"No se pudieron cargar las calificaciones."});}
  });
  return router;
};
