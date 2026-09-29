const nodemailer = require('nodemailer');
const { pool } = require('../config/db');
require('dotenv').config();

// EMAIL_DRY_RUN=true builds every message and records it in email_log as
// 'DryRun' without contacting the SMTP server (test / UAT environments).
const DRY_RUN = process.env.EMAIL_DRY_RUN === 'true';

// Escapes text placed inside email HTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Loaded lazily: mailSettings reads the database and must not load at require time
const mailSettings = () => require('../services/mailSettings');

// Addresses used when a notification's To is blank (Mail Server settings, else NOTIFY_TO)
async function defaultRecipients() {
  return mailSettings().defaultRecipients();
}

// Transport for the given settings (from mailSettings.getEffective())
function createTransport(s) {
  if (DRY_RUN) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: Boolean(s.secure),
    auth: s.user ? { user: s.user, pass: s.password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

async function logEmail({ sdCode, notificationType, to, subject, triggerEvent, status, errorMessage }) {
  try {
    await pool.query(
      `INSERT INTO email_log (sd_code, notification_type, recipient, subject, trigger_event, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sdCode || null, notificationType, to, subject, triggerEvent || null, status, errorMessage || null]
    );
  } catch (err) {
    // A logging failure must not hide the outcome of the send itself
    console.error('Failed to write email_log:', err.message);
  }
}

/**
 * Sends one email and records it in email_log (Sent, Failed or DryRun).
 * `to` and `cc` may be strings or arrays. `settings` overrides the saved mail
 * server settings (used by "Send test email"). Re-throws send failures so the
 * caller can report them.
 */
async function sendMail({ to, cc = [], subject, html, notificationType, sdCode = null, triggerEvent = null, settings = null }) {
  const toList = Array.isArray(to) ? to.join(', ') : to;
  const ccList = Array.isArray(cc) ? cc.join(', ') : cc;
  // email_log keeps one recipient column: "to" plus any CC
  const logged = [toList || '(none)', ccList && `cc: ${ccList}`].filter(Boolean).join('; ');
  try {
    if (!toList) throw new Error('No recipient configured. Set To on the template or Default recipients on the Mail Server tab.');
    const s = settings || await mailSettings().getEffective();
    if (!DRY_RUN && !s.host) throw new Error('No SMTP server configured. Fill in the Mail Server tab of the Email Notification Master.');
    if (!s.from && !DRY_RUN) throw new Error('No sender email configured. Fill in the Mail Server tab of the Email Notification Master.');
    const info = await createTransport(s).sendMail({ from: s.from || undefined, to: toList, cc: ccList || undefined, subject, html });
    await logEmail({ sdCode, notificationType, to: logged, subject, triggerEvent, status: DRY_RUN ? 'DryRun' : 'Sent' });
    return info;
  } catch (err) {
    await logEmail({ sdCode, notificationType, to: logged, subject, triggerEvent, status: 'Failed', errorMessage: err.message });
    throw err;
  }
}

// Checks that the SMTP server accepts the connection and login (no email sent)
async function verifyConnection(settings) {
  if (DRY_RUN) return true;
  await createTransport(settings).verify();
  return true;
}

async function sendPasswordResetEmail(toEmail, userName, resetLink) {
  return sendMail({
    to: toEmail,
    subject: 'SD Maintenance App - Password Reset Request',
    notificationType: 'PASSWORD_RESET',
    triggerEvent: 'Forgot Password request',
    html: `
      <p>Hello ${escapeHtml(userName)},</p>
      <p>We received a request to reset your password for the SD Maintenance Application.</p>
      <p>Click the link below to reset your password. This link is valid for
      ${process.env.RESET_TOKEN_EXPIRES_MINUTES || 30} minutes.</p>
      <p><a href="${escapeHtml(resetLink)}">${escapeHtml(resetLink)}</a></p>
      <p>If you did not request this, please ignore this email.</p>
      <br/>
      <p>SD Maintenance Application Team</p>
    `,
  });
}

module.exports = { sendMail, sendPasswordResetEmail, verifyConnection, escapeHtml, defaultRecipients, DRY_RUN };
