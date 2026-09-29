// SD email notifications:
//   * Landlord / Building Status changed Active -> Passive (sent after the save)
//   * Lease Commencement, Rent Commencement and Lease End reminders, sent by a
//     daily job for dates up to each template's trigger days ahead
// On/off, recipients, CC, trigger days and wording come from the Email
// Notification Master (notification_templates). Blank recipients fall back
// to the Mail Server default recipients (else NOTIFY_TO). Every email is
// recorded in email_log.
const { pool } = require('../config/db');
const { sendMail, defaultRecipients } = require('../utils/emailService');
const { formatDMY } = require('../utils/dates');
const templateModel = require('../models/notificationTemplateModel');
const { DEFINITIONS, DEFAULT_DAYS_BEFORE, sdVars, render, parseEmails } = require('./notificationTemplates');

const REMINDER_LOCK_ID = 7401501; // pg advisory lock: one reminder run at a time across servers

const REMINDERS = [
  { type: 'LEASE_COMMENCEMENT_REMINDER', column: 'lease_commencement_date', label: 'Lease Commencement Date' },
  { type: 'RENT_COMMENCEMENT_REMINDER', column: 'rent_commencement_date', label: 'Rent Commencement Date' },
  { type: 'LEASE_END_REMINDER', column: 'lease_end_date', label: 'Lease End Date' },
];

// To / CC lists for a template (blank To = the default recipients)
async function recipientsOf(tpl) {
  const to = parseEmails(tpl.to_recipients);
  return { to: to.length ? to : await defaultRecipients(), cc: parseEmails(tpl.cc_recipients) };
}

/**
 * Emails each Active -> Passive change of a saved SD record.
 * `sd` is the record as saved (joined, from sdMasterModel.findById);
 * `changes` = [{ statusType, oldStatus, newStatus }]. Never throws: a
 * failed send is recorded in email_log and must not undo the save.
 */
async function notifyStatusChanges(sd, changes, changedBy) {
  for (const c of changes) {
    if (c.oldStatus !== 'Active' || c.newStatus !== 'Passive') continue;
    const type = `${c.statusType.toUpperCase()}_STATUS_PASSIVE`;
    try {
      const tpl = await templateModel.get(type);
      if (!tpl || !tpl.is_enabled) continue;
      const { subject, html } = render(tpl, {
        ...sdVars(sd),
        status_type: c.statusType,
        changed_by: changedBy,
        changed_on: new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
      });
      await sendMail({
        ...(await recipientsOf(tpl)),
        subject,
        html,
        notificationType: type,
        sdCode: sd.sd_code,
        triggerEvent: `${c.statusType} Status Active -> Passive by ${changedBy}`,
      });
    } catch (err) {
      console.error(`Status notification for ${sd.sd_code} failed:`, err.message);
    }
  }
}

/**
 * Sends reminders for dates from `asOf` up to each template's trigger days
 * after it. Each SD Code + reminder type + date is emailed once: a later run
 * skips it once it was Sent (or DryRun); a Failed one is retried on the next
 * run. Disabled templates are skipped. Only SD Codes with Landlord and
 * Building Status Active are included.
 * asOf: 'YYYY-MM-DD' (defaults to today on the database server).
 * Returns { asOf, checked, sent, failed, skipped }.
 */
async function runDateReminders(asOf = null) {
  const client = await pool.connect();
  try {
    const locked = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [REMINDER_LOCK_ID])).rows[0].ok;
    if (!locked) return { skipped: true, reason: 'Another reminder run is in progress.' };

    const day = (await client.query('SELECT COALESCE($1::date, CURRENT_DATE)::text AS d', [asOf])).rows[0].d;
    const summary = { asOf: day, checked: 0, sent: 0, failed: 0, skipped: false };

    for (const r of REMINDERS) {
      const tpl = await templateModel.get(r.type, client);
      if (!tpl || !tpl.is_enabled) continue;
      const daysBefore = tpl.days_before ?? DEFAULT_DAYS_BEFORE;

      const due = await client.query(
        `SELECT s.*, cc.cost_center_code, cc.cost_center_name, l1.l1_name, l2.l2_name, l3.l3_name,
                s.${r.column}::text AS due_date
         FROM sd_master s
         JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
         JOIN location_l1 l1 ON l1.l1_id = s.l1_id
         JOIN location_l2 l2 ON l2.l2_id = s.l2_id
         JOIN location_l3 l3 ON l3.l3_id = s.l3_id
         WHERE s.${r.column} BETWEEN $1::date AND $1::date + $2::int
           AND s.landlord_status = 'Active' AND s.building_status = 'Active'
           AND NOT EXISTS (
             SELECT 1 FROM email_log e
             WHERE e.sd_code = s.sd_code AND e.notification_type = $3
               AND e.trigger_event = $4 || ' ' || to_char(s.${r.column}, 'DD/MM/YYYY')
               AND e.status IN ('Sent', 'DryRun'))
         ORDER BY s.${r.column}, s.sd_code`,
        [day, daysBefore, r.type, r.label]
      );

      for (const sd of due.rows) {
        summary.checked++;
        const dateText = formatDMY(sd.due_date);
        const daysLeft = Math.round((Date.parse(sd.due_date) - Date.parse(day)) / 864e5);
        const { subject, html } = render(tpl, {
          ...sdVars(sd),
          event_label: DEFINITIONS[r.type].dateLabel,
          due_date: dateText,
          days_left: String(daysLeft),
          days_left_text: daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`,
        });
        try {
          await sendMail({
            ...(await recipientsOf(tpl)),
            subject,
            html,
            notificationType: r.type,
            sdCode: sd.sd_code,
            triggerEvent: `${r.label} ${dateText}`,
          });
          summary.sent++;
        } catch (err) {
          summary.failed++;
        }
      }
    }
    return summary;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [REMINDER_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Runs the reminders every day at NOTIFY_TIME (HH:MM, server time, default
// 08:00), plus once a minute after start-up to catch up on a missed run.
// NOTIFY_ENABLED=false turns the schedule off.
function startReminderScheduler() {
  if (process.env.NOTIFY_ENABLED === 'false') {
    console.log('Reminder scheduler disabled (NOTIFY_ENABLED=false).');
    return;
  }
  const [hour, minute] = String(process.env.NOTIFY_TIME || '08:00').split(':').map(Number);

  const run = async (reason) => {
    try {
      const result = await runDateReminders();
      console.log(`Reminders (${reason}):`, JSON.stringify(result));
    } catch (err) {
      console.error('Reminder run failed:', err.message);
    }
  };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute || 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(async () => {
      await run('daily');
      scheduleNext();
    }, next - now);
  };

  scheduleNext();
  setTimeout(() => run('start-up catch-up'), 60 * 1000);
  console.log(`Reminder scheduler: daily at ${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}; trigger days per template (Email Notification Master).`);
}

module.exports = { REMINDERS, notifyStatusChanges, runDateReminders, startReminderScheduler };
