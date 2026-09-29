const { withTransaction } = require('../config/db');
const mailSettings = require('../services/mailSettings');
const { sendMail, verifyConnection, escapeHtml, DRY_RUN } = require('../utils/emailService');
const { isValidEmail } = require('../utils/validators');
const { logAudit } = require('../utils/audit');
const { httpError } = require('../utils/httpError');

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

function validationError(errors) {
  const err = httpError(400, errors.map((e) => `${e.field}: ${e.error}`).join(' '));
  err.errors = errors;
  return err;
}

// GET /api/mail-settings  (administrators)
async function get(req, res, next) {
  try {
    res.json({ success: true, data: await mailSettings.forScreen() });
  } catch (err) {
    next(err);
  }
}

// PUT /api/mail-settings  (administrators)
async function save(req, res, next) {
  try {
    const errors = mailSettings.validate(req.body, { isValidEmail });
    if (errors.length) throw validationError(errors);
    await withTransaction(async (db) => {
      const { before, after } = await mailSettings.save(req.body, req.user.userName, db);
      const passwordNote = req.body.clear_password ? 'SMTP password removed'
        : !blank(req.body.password) ? 'SMTP password changed' : null;
      await logAudit({
        tableName: 'mail_settings', recordId: 1, action: before ? 'UPDATE' : 'INSERT',
        actionBy: req.user.userName, oldValues: before, newValues: after,
        details: ['Mail server settings', passwordNote].filter(Boolean).join(': '),
      }, db);
    });
    res.json({ success: true, message: 'Mail server settings saved. They apply from the next email.', data: await mailSettings.forScreen() });
  } catch (err) {
    next(err);
  }
}

/**
 * Settings as they would be after saving the form: a blank field means the
 * .env value; a blank password keeps the stored one.
 */
async function settingsFromForm(body) {
  const env = mailSettings.envValues();
  const current = await mailSettings.getEffective({ fresh: true });
  const pick = (v, fallback) => (blank(v) ? fallback : String(v).trim());
  const fromName = pick(body.from_name, env.fromName);
  const fromEmail = pick(body.from_email, env.fromEmail);
  let password = current.password;
  if (body.clear_password) password = env.password;
  if (!blank(body.password)) password = body.password;
  return {
    host: pick(body.smtp_host, env.host),
    port: blank(body.smtp_port) ? env.port : Number(body.smtp_port),
    secure: body.smtp_secure === '' || body.smtp_secure === null || body.smtp_secure === undefined
      ? env.secure : body.smtp_secure === true || body.smtp_secure === 'true',
    user: pick(body.smtp_user, env.user),
    password,
    fromName,
    fromEmail,
    from: fromEmail ? (fromName ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>` : fromEmail) : '',
  };
}

// POST /api/mail-settings/test  { to, ...form }  (administrators)
// Checks the connection and login, then sends a short test email.
async function test(req, res, next) {
  try {
    const to = String(req.body.to || '').trim();
    if (!isValidEmail(to)) throw httpError(400, 'Enter a valid email address to send the test to.');
    const errors = mailSettings.validate(req.body, { isValidEmail });
    if (errors.length) throw validationError(errors);
    const s = await settingsFromForm(req.body);
    if (!DRY_RUN && !s.host) throw httpError(400, 'Enter the SMTP server.');
    if (!DRY_RUN && !s.fromEmail) throw httpError(400, 'Enter the sender email.');

    try {
      await verifyConnection(s);
    } catch (err) {
      throw httpError(400, `Could not connect or log in to ${s.host}:${s.port} - ${err.message}`);
    }
    try {
      await sendMail({
        to,
        subject: 'SD Maintenance Application - test email',
        notificationType: 'TEST_EMAIL',
        triggerEvent: `Test from Mail Server settings by ${req.user.userName}`,
        settings: s,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px">
          <p>This is a test email from the SD Maintenance Application.</p>
          <p>If you received it, the mail server settings are working.</p>
          <p style="color:#777;font-size:12px">Sent by ${escapeHtml(req.user.userName)} via ${escapeHtml(s.host || 'dry run')}:${s.port}
          as ${escapeHtml(s.from || '(no sender)')}.</p></div>`,
      });
    } catch (err) {
      throw httpError(400, `Connected, but the email was not accepted: ${err.message}`);
    }
    res.json({
      success: true,
      message: DRY_RUN
        ? `Dry-run mode is on (EMAIL_DRY_RUN=true): the test email to ${to} was logged but not sent.`
        : `Test email sent to ${to}. Check the inbox (and spam folder).`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { get, save, test };
