// SD email notifications:
//   * Landlord / Building Status changed Active -> Passive (sent after the save)
//   * Lease Commencement, Rent Commencement and Lease End reminders, sent by a
//     daily job for dates up to NOTIFY_DAYS_BEFORE (default 15) days ahead
// Recipients: NOTIFY_TO. Every email is recorded in email_log.
const { pool } = require('../config/db');
const { sendMail, escapeHtml, notifyRecipients } = require('../utils/emailService');
const { formatDMY } = require('../utils/dates');

const DAYS_BEFORE = Number(process.env.NOTIFY_DAYS_BEFORE) || 15;
const REMINDER_LOCK_ID = 7401501; // pg advisory lock: one reminder run at a time across servers

const REMINDERS = [
  { type: 'LEASE_COMMENCEMENT_REMINDER', column: 'lease_commencement_date', label: 'Lease Commencement Date' },
  { type: 'RENT_COMMENCEMENT_REMINDER', column: 'rent_commencement_date', label: 'Rent Commencement Date' },
  { type: 'LEASE_END_REMINDER', column: 'lease_end_date', label: 'Lease End Date' },
];

// Key facts of an SD record as an HTML table
function sdTable(sd) {
  const rows = [
    ['SD Code', sd.sd_code],
    ['Lease ID', sd.lease_id],
    ['Agreement No.', sd.agreement_no],
    ['Cost Center', `${sd.cost_center_code} - ${sd.cost_center_name}`],
    ['Location', `${sd.l1_name} > ${sd.l2_name} > ${sd.l3_name}`],
    ['Floor', sd.floor],
    ['Landlord', sd.landlord_name],
    ['Landlord Status', sd.landlord_status],
    ['Building Status', sd.building_status],
    ['Lease Commencement Date', formatDMY(sd.lease_commencement_date)],
    ['Rent Commencement Date', formatDMY(sd.rent_commencement_date)],
    ['Lease End Date', formatDMY(sd.lease_end_date)],
  ];
  return `<table cellpadding="4" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
    ${rows.map(([k, v]) => `<tr><td style="color:#555">${k}</td><td><strong>${escapeHtml(v || '-')}</strong></td></tr>`).join('')}
  </table>`;
}

function wrap(intro, sd) {
  return `<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>${intro}</p>
    ${sdTable(sd)}
    <p style="color:#777;font-size:12px">Automated message from the SD Maintenance Application.</p>
  </div>`;
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
    const subject = `SD ${sd.sd_code}: ${c.statusType} Status changed to Passive`;
    try {
      await sendMail({
        to: notifyRecipients(),
        subject,
        notificationType: `${c.statusType.toUpperCase()}_STATUS_PASSIVE`,
        sdCode: sd.sd_code,
        triggerEvent: `${c.statusType} Status Active -> Passive by ${changedBy}`,
        html: wrap(
          `${escapeHtml(c.statusType)} Status of <strong>${escapeHtml(sd.sd_code)}</strong> was changed from Active to Passive by ${escapeHtml(changedBy)}.
           Existing transactions remain visible; no new transactions can be recorded for this SD Code.`,
          sd
        ),
      });
    } catch (err) {
      console.error(`Status notification for ${sd.sd_code} failed:`, err.message);
    }
  }
}

/**
 * Sends reminders for dates from `asOf` up to DAYS_BEFORE days after it.
 * Each SD Code + reminder type + date is emailed once: a later run skips it
 * once it was Sent (or DryRun); a Failed one is retried on the next run.
 * Only SD Codes with Landlord and Building Status Active are included.
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
        [day, DAYS_BEFORE, r.type, r.label]
      );

      for (const sd of due.rows) {
        summary.checked++;
        const dateText = formatDMY(sd.due_date);
        const daysLeft = Math.round((Date.parse(sd.due_date) - Date.parse(day)) / 864e5);
        const when = daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`;
        try {
          await sendMail({
            to: notifyRecipients(),
            subject: `Reminder: ${sd.sd_code} ${r.label} on ${dateText}`,
            notificationType: r.type,
            sdCode: sd.sd_code,
            triggerEvent: `${r.label} ${dateText}`,
            html: wrap(
              `${escapeHtml(r.label)} for <strong>${escapeHtml(sd.sd_code)}</strong> is on <strong>${dateText}</strong> (${when}).`,
              sd
            ),
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
  console.log(`Reminder scheduler: daily at ${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}, ${DAYS_BEFORE} days ahead.`);
}

module.exports = { REMINDERS, DAYS_BEFORE, notifyStatusChanges, runDateReminders, startReminderScheduler };
