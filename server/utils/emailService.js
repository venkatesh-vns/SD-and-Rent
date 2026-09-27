const nodemailer = require('nodemailer');
const { pool } = require('../config/db');
require('dotenv').config();

// EMAIL_DRY_RUN=true builds every message and records it in email_log as
// 'DryRun' without contacting the SMTP server (test / UAT environments).
const DRY_RUN = process.env.EMAIL_DRY_RUN === 'true';

const transporter = DRY_RUN
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

// Escapes text placed inside email HTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Recipients of SD notifications (NOTIFY_TO, comma-separated)
function notifyRecipients() {
  return String(process.env.NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
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
 * `to` may be a string or an array. Re-throws send failures so the caller
 * can report them.
 */
async function sendMail({ to, subject, html, notificationType, sdCode = null, triggerEvent = null }) {
  const recipient = Array.isArray(to) ? to.join(', ') : to;
  try {
    if (!recipient) throw new Error('No recipient configured (set NOTIFY_TO in the server .env).');
    const info = await transporter.sendMail({ from: process.env.SMTP_FROM, to: recipient, subject, html });
    await logEmail({ sdCode, notificationType, to: recipient, subject, triggerEvent, status: DRY_RUN ? 'DryRun' : 'Sent' });
    return info;
  } catch (err) {
    await logEmail({ sdCode, notificationType, to: recipient || '(none)', subject, triggerEvent, status: 'Failed', errorMessage: err.message });
    throw err;
  }
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

module.exports = { sendMail, sendPasswordResetEmail, escapeHtml, notifyRecipients, DRY_RUN };
