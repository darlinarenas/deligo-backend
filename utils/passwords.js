const bcrypt = require("bcryptjs");

const BCRYPT_PREFIX = /^\$2[aby]\$/;

function isPasswordHash(value) {
  return BCRYPT_PREFIX.test(String(value || ""));
}

async function verifyPassword(password, storedPassword) {
  const candidate = String(password || "");
  const stored = String(storedPassword || "");

  if (!candidate || !stored) return false;

  if (isPasswordHash(stored)) {
    return bcrypt.compare(candidate, stored);
  }

  return candidate === stored;
}

module.exports = {
  isPasswordHash,
  verifyPassword
};
