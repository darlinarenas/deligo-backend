const crypto = require('crypto');

function clean(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');
}

function decodeBase64Url(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}

function encodeBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function validPublicKey(value) {
  try {
    const raw = decodeBase64Url(value);
    return raw.length === 65 && raw[0] === 4;
  } catch (_) {
    return false;
  }
}

function derivePublicKey(privateKey) {
  const rawPrivate = decodeBase64Url(privateKey);
  if (rawPrivate.length !== 32) throw new Error('VAPID_PRIVATE_KEY no contiene una clave P-256 válida.');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(rawPrivate);
  return encodeBase64Url(ecdh.getPublicKey(null, 'uncompressed'));
}

function getVapidDetails() {
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY);
  let publicKey = clean(process.env.VAPID_PUBLIC_KEY);
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:soporte@bhuz.app').trim();
  if (!privateKey) return { configured: false, subject, publicKey: '', privateKey: '' };

  const derivedPublicKey = derivePublicKey(privateKey);
  // La clave derivada de la privada es siempre la pareja exacta y válida.
  if (!validPublicKey(publicKey) || publicKey !== derivedPublicKey) publicKey = derivedPublicKey;

  return { configured: true, subject, publicKey, privateKey };
}

module.exports = { getVapidDetails, validPublicKey };
