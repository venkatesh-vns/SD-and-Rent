// Encrypts small secrets (e.g. the SMTP password) before they are stored.
// AES-256-GCM with a key derived from SETTINGS_SECRET, or JWT_SECRET when
// that is not set. If the secret changes, stored secrets must be re-entered.
const crypto = require('crypto');

function key() {
  const secret = process.env.SETTINGS_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Set SETTINGS_SECRET (or JWT_SECRET) in server/.env before saving passwords.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// Returns the plain text, or null when it cannot be decrypted (e.g. the key changed)
function decrypt(payload) {
  try {
    const [, iv, tag, data] = String(payload).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    return null;
  }
}

module.exports = { encrypt, decrypt };
