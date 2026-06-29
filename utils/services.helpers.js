/* ==========================================================
   BHUZ - SERVICES HELPERS
   Archivo: utils/services.helpers.js

   Objetivo:
   - Helpers reutilizables para servicios BHUZ.
   - Sirve para paquetes hoy y para futuros módulos después.
   - No toca comida, restaurantes ni pedidos existentes.
========================================================== */

const crypto = require("crypto");

function generarIdServicio(prefix = "service") {
  const cleanPrefix = String(prefix || "service").trim().toLowerCase();
  return `${cleanPrefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function generarTokenServicio() {
  return crypto.randomBytes(24).toString("hex");
}

function generarCodigoEntrega() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function limpiarTexto(valor) {
  return String(valor || "").trim();
}

function normalizarEmail(valor) {
  return limpiarTexto(valor).toLowerCase();
}

function numero(valor, fallback = 0) {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function redondear(valor) {
  return Math.round(numero(valor, 0) * 100) / 100;
}

function gradosARadianes(grados) {
  return grados * (Math.PI / 180);
}

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const nLat1 = numero(lat1);
  const nLng1 = numero(lng1);
  const nLat2 = numero(lat2);
  const nLng2 = numero(lng2);

  if (!nLat1 || !nLng1 || !nLat2 || !nLng2) {
    return 0;
  }

  const radioTierraKm = 6371;
  const dLat = gradosARadianes(nLat2 - nLat1);
  const dLng = gradosARadianes(nLng2 - nLng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(gradosARadianes(nLat1)) *
      Math.cos(gradosARadianes(nLat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return redondear(radioTierraKm * c);
}

function calcularMontoEnvio(distanciaKm) {
  /*
    Fórmula temporal BHUZ Envíos:
    - Base: 2.00 USD
    - Km: 0.65 USD
    - Mínimo: 2.50 USD

    Luego se podrá reemplazar por reglas por zona, lluvia, horario,
    tipo de vehículo, disponibilidad o ciudad.
  */
  const base = 2.0;
  const porKm = 0.65;
  const minimo = 2.5;

  return redondear(Math.max(minimo, base + numero(distanciaKm, 0) * porKm));
}

function normalizarEstadoServicio(estado) {
  const value = limpiarTexto(estado)
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  const estadosPermitidos = new Set([
    "PENDING_PAYMENT",
    "PAID",
    "WAITING_RECEIVER_LOCATION",
    "SEARCHING_DRIVER",
    "DRIVER_ASSIGNED",
    "GOING_TO_PICKUP",
    "PACKAGE_PICKED",
    "GOING_TO_DELIVERY",
    "DELIVERED",
    "CANCELLED"
  ]);

  return estadosPermitidos.has(value) ? value : "PENDING_PAYMENT";
}

function mapearServicio(row) {
  if (!row) return null;

  return {
    id: row.id || "",
    serviceType: row.service_type || "PACKAGE",

    customerEmail: normalizarEmail(row.customer_email || ""),
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",

    receiverName: row.receiver_name || "",
    receiverPhone: row.receiver_phone || "",

    pickupAddress: row.pickup_address || "",
    pickupReference: row.pickup_reference || "",
    pickupLatitude: row.pickup_latitude || "",
    pickupLongitude: row.pickup_longitude || "",

    deliveryAddress: row.delivery_address || "",
    deliveryReference: row.delivery_reference || "",
    deliveryLatitude: row.delivery_latitude || "",
    deliveryLongitude: row.delivery_longitude || "",

    packageDescription: row.package_description || "",
    packageSize: row.package_size || "",
    packagePhotoUrl: row.package_photo_url || "",

    distanceKm: Number(row.distance_km || 0),
    totalAmount: Number(row.total_amount || 0),
    paymentStatus: row.payment_status || "PENDING",
    paymentMethod: row.payment_method || "",

    status: row.status || "PENDING_PAYMENT",

    deliveryCode: row.delivery_code || "",
    deliveryCodeUsed: row.delivery_code_used === true,

    driverId: row.driver_id || "",
    driverName: row.driver_name || "",
    driverPhone: row.driver_phone || "",

    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapearTokenServicio(row) {
  if (!row) return null;

  return {
    id: row.id || "",
    serviceId: row.service_id || "",
    token: row.token || "",
    tokenType: row.token_type || "RECEIVER_LOCATION",
    receiverLatitude: row.receiver_latitude || "",
    receiverLongitude: row.receiver_longitude || "",
    receiverConfirmed: row.receiver_confirmed === true,
    expiresAt: row.expires_at || null,
    confirmedAt: row.confirmed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function buildFrontendBaseUrl(value, req) {
  /*
    El link del receptor lo arma el backend.
    Fuente principal: process.env.FRONTEND_URL.
    Fallback seguro de pruebas: frontend Vercel del proyecto.
  */
  const fromEnv = limpiarTexto(process.env.FRONTEND_URL || "");

  if (fromEnv) {
    return fromEnv.endsWith("/") ? fromEnv : `${fromEnv}/`;
  }

  const fallback = "https://deli-go-frontend-wheat.vercel.app/index.html";
  return fallback.endsWith("/") ? fallback : `${fallback}/`;
}

function buildReceiverConfirmUrl(baseUrl, token) {
  const cleanBase = limpiarTexto(baseUrl);

  if (!cleanBase) {
    return `/?confirmar_envio=${encodeURIComponent(token)}#envios`;
  }

  return `${cleanBase}?confirmar_envio=${encodeURIComponent(token)}#envios`;
}

module.exports = {
  generarIdServicio,
  generarTokenServicio,
  generarCodigoEntrega,
  limpiarTexto,
  normalizarEmail,
  numero,
  redondear,
  calcularDistanciaKm,
  calcularMontoEnvio,
  normalizarEstadoServicio,
  mapearServicio,
  mapearTokenServicio,
  buildFrontendBaseUrl,
  buildReceiverConfirmUrl
};

