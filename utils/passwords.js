const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const BCRYPT_PREFIX = /^\$2[aby]\$/;

function isPasswordHash(value) {
  return BCRYPT_PREFIX.test(String(value || ''));
}

async function hashPassword(password) {
  const value = String(password || '');
  if (!value) throw new Error('La contraseña no puede estar vacía');
  if (isPasswordHash(value)) return value;
  return bcrypt.hash(value, BCRYPT_ROUNDS);
}

async function verifyPassword(password, storedPassword) {
  const candidate = String(password || '');
  const stored = String(storedPassword || '');
  if (!candidate || !stored) return false;
  if (isPasswordHash(stored)) return bcrypt.compare(candidate, stored);
  return candidate === stored;
}

async function verifyAndUpgradePassword({ password, storedPassword, onUpgrade }) {
  const valid = await verifyPassword(password, storedPassword);
  if (!valid) return false;

  if (!isPasswordHash(storedPassword) && typeof onUpgrade === 'function') {
    const upgradedHash = await hashPassword(password);
    await onUpgrade(upgradedHash);
  }

  return true;
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyAndUpgradePassword,
  isPasswordHash
};
