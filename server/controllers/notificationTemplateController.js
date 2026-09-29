const { withTransaction } = require('../config/db');
const templateModel = require('../models/notificationTemplateModel');
const tpl = require('../services/notificationTemplates');
const { logAudit } = require('../utils/audit');
const { defaultRecipients } = require('../utils/emailService');
const { httpError } = require('../utils/httpError');

function typeOf(req) {
  const type = String(req.params.type || '').toUpperCase();
  if (!tpl.TYPES.includes(type)) throw httpError(404, 'Unknown notification type.');
  return type;
}

// Stored row + what the screen needs to edit it
function toView(row) {
  const type = row.notification_type;
  const def = tpl.DEFINITIONS[type];
  return {
    ...row,
    name: def.name,
    description: def.description,
    is_reminder: tpl.REMINDER_TYPES.includes(type),
    date_label: def.dateLabel || null,
    placeholders: tpl.placeholdersFor(type),
  };
}

// Body fields -> column values (blank recipients stored as NULL)
function fromBody(type, body) {
  const clean = (v) => (String(v ?? '').trim() ? tpl.parseEmails(v).join(', ') : null);
  return {
    is_enabled: Boolean(body.is_enabled),
    to_recipients: clean(body.to_recipients),
    cc_recipients: clean(body.cc_recipients),
    days_before: tpl.REMINDER_TYPES.includes(type) ? Number(body.days_before) : null,
    subject: String(body.subject ?? '').trim(),
    body: String(body.body ?? '').replace(/\r\n/g, '\n'),
    include_details: body.include_details !== false,
  };
}

// GET /api/notification-templates
async function list(req, res, next) {
  try {
    const rows = await templateModel.getAll();
    res.json({ success: true, data: rows.map(toView), defaultRecipients: (await defaultRecipients()).join(', ') });
  } catch (err) {
    next(err);
  }
}

// PUT /api/notification-templates/:type
async function update(req, res, next) {
  try {
    const type = typeOf(req);
    const data = fromBody(type, req.body);
    const errors = tpl.validate(type, { ...req.body, ...data, days_before: req.body.days_before });
    if (errors.length) {
      const err = httpError(400, errors.map((e) => `${e.field}: ${e.error}`).join(' '));
      err.errors = errors;
      throw err;
    }
    const saved = await withTransaction(async (db) => {
      const before = await templateModel.get(type, db);
      const after = await templateModel.update(type, data, req.user.userName, db);
      await logAudit({
        tableName: 'notification_templates', recordId: after.template_id, action: 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after, details: tpl.DEFINITIONS[type].name,
      }, db);
      return after;
    });
    res.json({ success: true, message: `${tpl.DEFINITIONS[type].name} saved.`, data: toView(saved) });
  } catch (err) {
    next(err);
  }
}

// POST /api/notification-templates/:type/reset  - back to the default wording and settings
async function reset(req, res, next) {
  try {
    const type = typeOf(req);
    const saved = await withTransaction(async (db) => {
      const before = await templateModel.get(type, db);
      const after = await templateModel.update(type, tpl.defaultRow(type), req.user.userName, db);
      await logAudit({
        tableName: 'notification_templates', recordId: after.template_id, action: 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after,
        details: `${tpl.DEFINITIONS[type].name}: restored default`,
      }, db);
      return after;
    });
    res.json({ success: true, message: `${tpl.DEFINITIONS[type].name} restored to the default.`, data: toView(saved) });
  } catch (err) {
    next(err);
  }
}

// POST /api/notification-templates/:type/preview  - render unsaved edits with sample data
async function preview(req, res, next) {
  try {
    const type = typeOf(req);
    const data = fromBody(type, req.body);
    const rendered = tpl.render(data, tpl.sampleVars(type, req.body.days_before));
    const { to, cc } = {
      to: tpl.parseEmails(data.to_recipients),
      cc: tpl.parseEmails(data.cc_recipients),
    };
    res.json({
      success: true,
      data: {
        ...rendered,
        to: (to.length ? to : await defaultRecipients()).join(', ') || '(no recipient set)',
        cc: cc.join(', '),
        errors: tpl.validate(type, { ...req.body, ...data, days_before: req.body.days_before }),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, update, reset, preview };
