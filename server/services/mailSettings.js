// Mail server (SMTP) and sender settings: the mail_settings row, with any
// blank value falling back to server/.env. Cached for a minute and cleared
// whenever the settings are saved.
const { pool } = require('../config/db');
const { encrypt, decrypt } = require('../utils/secret');

const CACHE_MS = 60 * 1000;
let cache = null;
let cachedAt = 0;

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// "a@x.com, b@y.com; c@z.com" -> ['a@x.com', 'b@y.com', 'c@z.com']
function parseEmails(text) {
  return String(text || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

async function getRow(db = pool) {
  const result = await db.query('SELECT * FROM mail_settings WHERE setting_id = 1');
  return result.rows[0] || null;
}

// "SD Maintenance <you@x.com>" -> { name, email }
function splitFrom(text) {
  const m = String(text || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: String(text || '').trim() };
}

// Values from server/.env, in the same shape
function envValues() {
  const from = splitFrom(process.env.SMTP_FROM);
  return {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: from.name,
    fromEmail: from.email,
    defaultRecipients: parseEmails(process.env.NOTIFY_TO),
  };
}

/**
 * Settings actually used to send mail: saved values, else .env values.
 * { host, port, secure, user, password, from, fromName, fromEmail, defaultRecipients }
 */
async function getEffective({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const row = await getRow();
  const env = envValues();
  const pick = (saved, fallback) => (blank(saved) ? fallback : saved);
  const password = row?.smtp_password_enc ? decrypt(row.smtp_password_enc) : null;
  const fromName = pick(row?.from_name, env.fromName);
  const fromEmail = pick(row?.from_email, env.fromEmail);
  cache = {
    host: pick(row?.smtp_host, env.host),
    port: row?.smtp_port || env.port,
    secure: row?.smtp_secure ?? env.secure,
    user: pick(row?.smtp_user, env.user),
    password: password ?? env.password,
    passwordUnreadable: Boolean(row?.smtp_password_enc) && password === null,
    fromName,
    fromEmail,
    from: fromEmail ? (fromName ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>` : fromEmail) : '',
    defaultRecipients: row?.default_recipients ? parseEmails(row.default_recipients) : env.defaultRecipients,
  };
  cachedAt = Date.now();
  return cache;
}

function invalidate() {
  cache = null;
}

// Addresses used when a template's To is blank
async function defaultRecipients() {
  return (await getEffective()).defaultRecipients;
}

/**
 * What the settings screen shows: saved values (blank = using .env), the
 * .env value behind each blank field, and whether a password is stored.
 * The password itself is never returned.
 */
async function forScreen() {
  const row = await getRow();
  const env = envValues();
  const effective = await getEffective({ fresh: true });
  return {
    smtp_host: row?.smtp_host || '',
    smtp_port: row?.smtp_port ?? '',
    smtp_secure: row?.smtp_secure ?? null,
    smtp_user: row?.smtp_user || '',
    from_name: row?.from_name || '',
    from_email: row?.from_email || '',
    default_recipients: row?.default_recipients || '',
    has_password: Boolean(row?.smtp_password_enc),
    password_unreadable: effective.passwordUnreadable,
    env: {
      smtp_host: env.host,
      smtp_port: String(env.port),
      smtp_secure: env.secure,
      smtp_user: env.user,
      has_password: Boolean(env.password),
      from_name: env.fromName,
      from_email: env.fromEmail,
      default_recipients: env.defaultRecipients.join(', '),
    },
    dry_run: process.env.EMAIL_DRY_RUN === 'true',
    modified_by: row?.modified_by || null,
    modified_date: row?.modified_date || null,
  };
}

/**
 * Validates screen input. Returns [{ field, error }].
 */
function validate(body, { isValidEmail }) {
  const errors = [];
  if (!blank(body.smtp_port)) {
    const p = Number(body.smtp_port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) errors.push({ field: 'Port', error: 'Port must be a number from 1 to 65535.' });
  }
  if (!blank(body.smtp_host) && !/^[a-zA-Z0-9.-]+$/.test(String(body.smtp_host).trim())) {
    errors.push({ field: 'SMTP server', error: 'Enter a host name such as smtp.office365.com.' });
  }
  if (!blank(body.from_email) && !isValidEmail(body.from_email)) errors.push({ field: 'Sender email', error: 'Not a valid email address.' });
  if (!blank(body.from_name) && String(body.from_name).length > 150) errors.push({ field: 'Sender name', error: 'At most 150 characters.' });
  const bad = parseEmails(body.default_recipients).filter((e) => !isValidEmail(e));
  if (bad.length) errors.push({ field: 'Default recipients', error: `Not a valid email address: ${bad.join(', ')}.` });
  return errors;
}

/**
 * Saves the settings row. `password`: non-blank = replace the stored one;
 * blank = keep it; `clear_password: true` = remove it (use .env).
 */
async function save(body, modifiedBy, db = pool) {
  const before = await getRow(db);
  let passwordEnc = before?.smtp_password_enc || null;
  if (body.clear_password) passwordEnc = null;
  else if (!blank(body.password)) passwordEnc = encrypt(body.password);
  const secure = body.smtp_secure === '' || body.smtp_secure === null || body.smtp_secure === undefined
    ? null : body.smtp_secure === true || body.smtp_secure === 'true';
  const values = [
    blank(body.smtp_host) ? null : String(body.smtp_host).trim(),
    blank(body.smtp_port) ? null : Number(body.smtp_port),
    secure,
    blank(body.smtp_user) ? null : String(body.smtp_user).trim(),
    passwordEnc,
    blank(body.from_name) ? null : String(body.from_name).trim(),
    blank(body.from_email) ? null : String(body.from_email).trim(),
    blank(body.default_recipients) ? null : parseEmails(body.default_recipients).join(', '),
    modifiedBy,
  ];
  const result = await db.query(
    `INSERT INTO mail_settings (setting_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc,
                                from_name, from_email, default_recipients, modified_by, modified_date)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (setting_id) DO UPDATE SET
       smtp_host = $1, smtp_port = $2, smtp_secure = $3, smtp_user = $4, smtp_password_enc = $5,
       from_name = $6, from_email = $7, default_recipients = $8, modified_by = $9, modified_date = NOW()
     RETURNING *`,
    values
  );
  invalidate();
  return { before, after: result.rows[0] };
}

module.exports = { parseEmails, getEffective, invalidate, defaultRecipients, forScreen, validate, save, envValues };
