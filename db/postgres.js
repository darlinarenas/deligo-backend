/* ======================================================
   CONEXIÓN POSTGRESQL / SUPABASE
   Archivo separado para mantener server.js más limpio.
   IMPORTANTE:
   - No cambia rutas.
   - No cambia lógica de negocio.
   - Solo exporta pool para que server.js siga usando PostgreSQL igual que antes.
====================================================== */

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then((client) => {
    console.log("=================================");
    console.log("✅ PostgreSQL conectado correctamente");
    console.log("=================================");
    client.release();
  })
  .catch((error) => {
    console.error("❌ Error conectando PostgreSQL:", error.message);
  });

module.exports = {
  pool
};
