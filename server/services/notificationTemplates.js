// Email templates for SD notifications: defaults, {{placeholders}},
// rendering and validation. The editable copies live in the
// notification_templates table (Email Notification Master screen).
const { escapeHtml } = require('../utils/emailService');
const { formatDMY } = require('../utils/dates');
const { isValidEmail } = require('../utils/validators');

const REMINDER_TYPES = ['LEASE_COMMENCEMENT_REMINDER', 'RENT_COMMENCEMENT_REMINDER', 'LEASE_END_REMINDER'];
const STATUS_TYPES = ['LANDLORD_STATUS_PASSIVE', 'BUILDING_STATUS_PASSIVE'];
const DEFAULT_DAYS_BEFORE = Number(process.env.NOTIFY_DAYS_BEFORE) || 15;

const SIGN_OFF = '\n\nRegards,\nSD and Rent Maintenance Application';

const reminderBody = (action) =>
  `Dear Team,\n\nThe {{event_label}} for {{sd_code}} ({{landlord_name}}, {{location}}) is on {{due_date}} - {{days_left_text}}.\n\n${action}${SIGN_OFF}`;
const statusBody =
  'Dear Team,\n\nThe {{status_type}} Status of {{sd_code}} ({{landlord_name}}, {{location}}) was changed from Active to Passive by {{changed_by}} on {{changed_on}}.\n\n'
  + `Existing transactions remain visible; no new transactions can be recorded for this SD Code.${SIGN_OFF}`;

// One entry per notification type, in screen order
const DEFINITIONS = {
  LEASE_COMMENCEMENT_REMINDER: {
    name: 'Lease Commencement Reminder',
    description: 'Sent before the Lease Commencement Date of each Active SD Code.',
    dateLabel: 'Lease Commencement Date',
    subject: 'Reminder: {{sd_code}} Lease Commencement Date on {{due_date}}',
    body: reminderBody('Please make sure the premises, agreement and deposit are ready.'),
  },
  RENT_COMMENCEMENT_REMINDER: {
    name: 'Rent Commencement Reminder',
    description: 'Sent before the Rent Commencement Date of each Active SD Code.',
    dateLabel: 'Rent Commencement Date',
    subject: 'Reminder: {{sd_code}} Rent Commencement Date on {{due_date}}',
    body: reminderBody('Please make sure rent payments are set up from this date.'),
  },
  LEASE_END_REMINDER: {
    name: 'Lease End Reminder',
    description: 'Sent before the Lease End Date of each Active SD Code.',
    dateLabel: 'Lease End Date',
    subject: 'Reminder: {{sd_code}} Lease End Date on {{due_date}}',
    body: reminderBody('Please review renewal or exit, and the refund of the Security Deposit.'),
  },
  LANDLORD_STATUS_PASSIVE: {
    name: 'Landlord Status changed to Passive',
    description: 'Sent immediately when an SD record\'s Landlord Status changes from Active to Passive.',
    subject: 'SD {{sd_code}}: Landlord Status changed to Passive',
    body: statusBody,
  },
  BUILDING_STATUS_PASSIVE: {
    name: 'Building Status changed to Passive',
    description: 'Sent immediately when an SD record\'s Building Status changes from Active to Passive.',
    subject: 'SD {{sd_code}}: Building Status changed to Passive',
    body: statusBody,
  },
};
const TYPES = Object.keys(DEFINITIONS);

// Placeholders: name -> description (shown on the screen)
const COMMON_PLACEHOLDERS = {
  sd_code: 'SD Code',
  lease_id: 'Lease ID',
  agreement_no: 'Agreement No.',
  landlord_name: 'Landlord Name',
  cost_center: 'Cost Center name',
  location: 'Location (Level 1 > Level 2 > Level 3)',
  floor: 'Floor',
  landlord_status: 'Landlord Status',
  building_status: 'Building Status',
  agreement_value: 'Agreement Value',
  lease_commencement_date: 'Lease Commencement Date',
  rent_commencement_date: 'Rent Commencement Date',
  lease_end_date: 'Lease End Date',
};
const REMINDER_PLACEHOLDERS = {
  event_label: 'Which date, e.g. "Lease End Date"',
  due_date: 'The date being reminded about',
  days_left: 'Days until that date (number)',
  days_left_text: '"in 15 days" / "today"',
};
const STATUS_PLACEHOLDERS = {
  status_type: '"Landlord" or "Building"',
  changed_by: 'User who made the change',
  changed_on: 'Date and time of the change',
};

function placeholdersFor(type) {
  return {
    ...COMMON_PLACEHOLDERS,
    ...(REMINDER_TYPES.includes(type) ? REMINDER_PLACEHOLDERS : STATUS_PLACEHOLDERS),
  };
}

// Stored row from a definition (used to create missing rows and for "Restore default")
function defaultRow(type) {
  const d = DEFINITIONS[type];
  return {
    notification_type: type,
    is_enabled: true,
    to_recipients: null,
    cc_recipients: null,
    days_before: REMINDER_TYPES.includes(type) ? DEFAULT_DAYS_BEFORE : null,
    subject: d.subject,
    body: d.body,
    include_details: true,
  };
}

const money = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Placeholder values for an SD record (joined row from sd_master queries)
function sdVars(sd) {
  return {
    sd_code: sd.sd_code,
    lease_id: sd.lease_id,
    agreement_no: sd.agreement_no,
    landlord_name: sd.landlord_name,
    cost_center: sd.cost_center_name,
    location: [sd.l1_name, sd.l2_name, sd.l3_name].filter(Boolean).join(' > '),
    floor: sd.floor,
    landlord_status: sd.landlord_status,
    building_status: sd.building_status,
    agreement_value: money(sd.agreement_value),
    lease_commencement_date: formatDMY(sd.lease_commencement_date),
    rent_commencement_date: formatDMY(sd.rent_commencement_date),
    lease_end_date: formatDMY(sd.lease_end_date),
  };
}

// Key facts of an SD record as an HTML table (optional part of every email)
function sdTable(v) {
  const rows = [
    ['SD Code', v.sd_code], ['Lease ID', v.lease_id], ['Agreement No.', v.agreement_no],
    ['Cost Center', v.cost_center], ['Location', v.location], ['Floor', v.floor],
    ['Landlord', v.landlord_name], ['Landlord Status', v.landlord_status], ['Building Status', v.building_status],
    ['Agreement Value', v.agreement_value], ['Lease Commencement Date', v.lease_commencement_date],
    ['Rent Commencement Date', v.rent_commencement_date], ['Lease End Date', v.lease_end_date],
  ];
  return `<table cellpadding="5" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-top:12px;border:1px solid #e3e8e5">
    ${rows.map(([k, val]) => `<tr><td style="color:#555;border-bottom:1px solid #eef1ef">${k}</td><td style="border-bottom:1px solid #eef1ef"><strong>${escapeHtml(val || '-')}</strong></td></tr>`).join('')}
  </table>`;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
const fill = (text, vars, esc) => String(text).replace(PLACEHOLDER_RE, (m, name) => {
  const v = vars[name.toLowerCase()];
  return v === undefined || v === null ? '' : esc(String(v));
});

/**
 * Renders a template with placeholder values.
 * Returns { subject, html }. Values are HTML-escaped; the body's line
 * breaks become <br>.
 */
function render(tpl, vars) {
  const subject = fill(tpl.subject, vars, (s) => s).replace(/\s+/g, ' ').trim();
  const body = fill(escapeHtml(tpl.body), vars, escapeHtml).replace(/\r?\n/g, '<br>');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.55">
    <div>${body}</div>
    ${tpl.include_details ? sdTable(vars) : ''}
    <p style="color:#888;font-size:12px;margin-top:16px">Automated message from the SD and Rent Maintenance Application.</p>
  </div>`;
  return { subject, html };
}

// "a@x.com, b@y.com; c@z.com" -> ['a@x.com', 'b@y.com', 'c@z.com']
function parseEmails(text) {
  return String(text || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Validates an edited template. Returns [{ field, error }].
 */
function validate(type, t) {
  const errors = [];
  const allowed = placeholdersFor(type);
  const checkPlaceholders = (field, text) => {
    const unknown = [...String(text || '').matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((n) => !allowed[n.toLowerCase()]);
    if (unknown.length) errors.push({ field, error: `Unknown placeholder(s): ${[...new Set(unknown)].map((n) => `{{${n}}}`).join(', ')}.` });
  };

  if (!String(t.subject || '').trim()) errors.push({ field: 'Subject', error: 'Subject is required.' });
  else if (t.subject.length > 255) errors.push({ field: 'Subject', error: 'Subject must be 255 characters or fewer.' });
  if (!String(t.body || '').trim()) errors.push({ field: 'Body', error: 'Email body is required.' });
  else if (t.body.length > 10000) errors.push({ field: 'Body', error: 'Email body must be 10,000 characters or fewer.' });
  checkPlaceholders('Subject', t.subject);
  checkPlaceholders('Body', t.body);

  for (const [field, text] of [['To', t.to_recipients], ['CC', t.cc_recipients]]) {
    const list = parseEmails(text);
    const bad = list.filter((e) => !isValidEmail(e));
    if (bad.length) errors.push({ field, error: `Not a valid email address: ${bad.join(', ')}.` });
    if (list.length > 25) errors.push({ field, error: 'At most 25 addresses.' });
  }

  if (REMINDER_TYPES.includes(type)) {
    const d = t.days_before;
    if (d === null || d === undefined || d === '' || !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 365) {
      errors.push({ field: 'Trigger days', error: 'Trigger days must be a whole number from 0 to 365.' });
    }
  }
  return errors;
}

// Sample values for the screen's live preview
const SAMPLE_VARS = {
  sd_code: 'SD000123', lease_id: 'LSE-BLR-001', agreement_no: 'AGR-2021-114', landlord_name: 'Lakshmi Estates Pvt Ltd',
  cost_center: 'Bengaluru Operations', location: 'Karnataka > Bengaluru > Whitefield - Tower A', floor: '4',
  landlord_status: 'Active', building_status: 'Active', agreement_value: '45,00,000.00',
  lease_commencement_date: '01/04/2021', rent_commencement_date: '01/07/2021', lease_end_date: '31/03/2031',
};

function sampleVars(type, daysBefore) {
  if (REMINDER_TYPES.includes(type)) {
    const days = Number.isInteger(Number(daysBefore)) ? Number(daysBefore) : DEFAULT_DAYS_BEFORE;
    return {
      ...SAMPLE_VARS,
      event_label: DEFINITIONS[type].dateLabel,
      due_date: '31/03/2031',
      days_left: String(days),
      days_left_text: days === 0 ? 'today' : `in ${days} day(s)`,
    };
  }
  return {
    ...SAMPLE_VARS,
    landlord_status: type === 'LANDLORD_STATUS_PASSIVE' ? 'Passive' : 'Active',
    building_status: type === 'BUILDING_STATUS_PASSIVE' ? 'Passive' : 'Active',
    status_type: type === 'LANDLORD_STATUS_PASSIVE' ? 'Landlord' : 'Building',
    changed_by: 'admin',
    changed_on: new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
  };
}

module.exports = {
  TYPES, REMINDER_TYPES, STATUS_TYPES, DEFINITIONS, DEFAULT_DAYS_BEFORE,
  placeholdersFor, defaultRow, sdVars, render, parseEmails, validate, sampleVars,
};
