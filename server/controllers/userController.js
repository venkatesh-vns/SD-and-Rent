const bcrypt = require('bcryptjs');
const { withTransaction } = require('../config/db');
const userModel = require('../models/userModel');
const sessionModel = require('../models/sessionModel');
const { logAudit } = require('../utils/audit');
const { STATUSES, isValidEmail, passwordPolicyError } = require('../utils/validators');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');

const TEMPLATE_COLUMNS = [
  { header: 'User Name', required: true },
  { header: 'User Email ID', required: true },
  { header: 'Password', required: false },
  { header: 'Status', required: false },
];

// Assigned to uploaded users whose Password cell is blank
const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'Welcome@123';

// Returns an error message for the user fields, or null when valid
function validate({ userName, userEmail, status }) {
  if (!userName) return 'User Name is required.';
  if (userName.length > 100) return 'User Name must be 100 characters or fewer.';
  if (!userEmail) return 'User Email ID is required.';
  if (!isValidEmail(userEmail)) return 'User Email ID is not a valid email address.';
  if (status && !STATUSES.includes(status)) return 'Status must be Active or Inactive.';
  return null;
}

// GET /api/users?search=&status=
async function getAllUsers(req, res, next) {
  try {
    const users = await userModel.getAll(req.query);
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

// POST /api/users
async function createUser(req, res, next) {
  try {
    const userName = String(req.body.userName || '').trim();
    const userEmail = String(req.body.userEmail || '').trim();
    const { password } = req.body;
    const status = req.body.status || 'Active';

    const error = validate({ userName, userEmail, status }) || passwordPolicyError(password);
    if (error) return res.status(400).json({ success: false, message: error });

    const duplicates = await userModel.existsByNameOrEmail(userName, userEmail);
    if (duplicates.length > 0) {
      return res.status(409).json({ success: false, message: 'User Name or Email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await withTransaction(async (db) => {
      const row = await userModel.create({ userName, userEmail, passwordHash, status, createdBy: req.user.userName }, db);
      await logAudit({ tableName: 'users', recordId: row.user_id, action: 'INSERT', actionBy: req.user.userName, newValues: row }, db);
      return row;
    });

    res.status(201).json({ success: true, message: 'User created successfully. Assign User Rights before they log in.', data: newUser });
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/:id
async function updateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    const userName = String(req.body.userName || '').trim();
    const userEmail = String(req.body.userEmail || '').trim();
    const { status } = req.body;

    const error = validate({ userName, userEmail, status }) || (!status ? 'Status is required.' : null);
    if (error) return res.status(400).json({ success: false, message: error });

    const duplicates = await userModel.existsByNameOrEmail(userName, userEmail, id);
    if (duplicates.length > 0) {
      return res.status(409).json({ success: false, message: 'User Name or Email already used by another user.' });
    }

    const before = await userModel.findById(id);
    if (!before) return res.status(404).json({ success: false, message: 'User not found.' });
    if (status === 'Inactive' && id === req.user.userId) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }
    if (status === 'Inactive' && before.is_admin) {
      return res.status(400).json({ success: false, message: 'The administrator account cannot be deactivated.' });
    }

    const updated = await withTransaction(async (db) => {
      const after = await userModel.update(id, { userName, userEmail, status, modifiedBy: req.user.userName }, db);
      if (before.status === 'Active' && after.status === 'Inactive') {
        await sessionModel.endForUser(id, 'User deactivated', req.user.userName, {}, db);
      }
      await logAudit({
        tableName: 'users', recordId: id,
        action: before.status !== after.status ? 'STATUS_CHANGE' : 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after,
      }, db);
      return after;
    });

    res.json({ success: true, message: 'User updated successfully.', data: updated });
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/:id/password  - administrator sets a new password
async function resetUserPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { newPassword } = req.body;

    const policyError = passwordPolicyError(newPassword);
    if (policyError) return res.status(400).json({ success: false, message: policyError });

    const user = await userModel.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await withTransaction(async (db) => {
      await userModel.updatePassword(id, passwordHash, req.user.userName, db);
      await sessionModel.endForUser(id, 'Password reset by administrator', req.user.userName, {}, db);
      await logAudit({
        tableName: 'users', recordId: id, action: 'PASSWORD_RESET',
        actionBy: req.user.userName, details: 'Reset by administrator',
      }, db);
    });

    res.json({ success: true, message: `Password reset for ${user.user_name}. Their open sessions have been ended.` });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/users/:id
async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    const before = await userModel.findById(id);
    if (!before) return res.status(404).json({ success: false, message: 'User not found.' });
    if (id === req.user.userId) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    if (before.is_admin) {
      return res.status(400).json({ success: false, message: 'The administrator account cannot be deleted.' });
    }
    if (await userModel.hasActivity(before.user_name)) {
      return res.status(409).json({
        success: false,
        message: `${before.user_name} has created or changed records and cannot be deleted. Mark the user Inactive instead.`,
      });
    }

    await withTransaction(async (db) => {
      await userModel.remove(id, db);
      await logAudit({ tableName: 'users', recordId: id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
    });
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/template
async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'User_Template.xlsx', buildWorkbook('Users', TEMPLATE_COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

// GET /api/users/export?search=&status=
async function exportUsers(req, res, next) {
  try {
    const rows = await userModel.getAll(req.query);
    const buffer = buildWorkbook(
      'Users',
      ['User Name', 'User Email ID', 'Status', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((r) => [r.user_name, r.user_email, r.status, r.created_by, r.created_date, r.modified_by, r.modified_date])
    );
    await sendWorkbook(res, `Users_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// POST /api/users/bulk-upload  (Excel bulk upload)
async function bulkUploadUsers(req, res, next) {
  try {
    const result = await processUpload(req, {
      screenCode: SCREENS.USER,
      columns: TEMPLATE_COLUMNS,
      keyOf: (row) => row['User Name'],
      validateRow: async (row, { seen, rowNumber }) => {
        const userName = row['User Name'];
        const userEmail = row['User Email ID'];
        const password = row['Password'];
        const status = row['Status'] || 'Active';
        const errors = [];

        if (!userName) errors.push({ field: 'User Name', value: userName, error: 'User Name is required.' });
        else if (userName.length > 100) errors.push({ field: 'User Name', value: userName, error: 'Must be 100 characters or fewer.' });

        if (!userEmail) errors.push({ field: 'User Email ID', value: userEmail, error: 'User Email ID is required.' });
        else if (!isValidEmail(userEmail)) errors.push({ field: 'User Email ID', value: userEmail, error: 'Not a valid email address.' });

        if (password && passwordPolicyError(password)) {
          errors.push({ field: 'Password', value: '(hidden)', error: passwordPolicyError(password) });
        }
        if (!STATUSES.includes(status)) {
          errors.push({ field: 'Status', value: status, error: 'Status must be Active or Inactive.' });
        }

        for (const [field, value] of [['User Name', userName], ['User Email ID', userEmail]]) {
          if (!value) continue;
          const key = `${field}:${value.toLowerCase()}`;
          if (seen.has(key)) errors.push({ field, value, error: `Duplicate of row ${seen.get(key)} in this file.` });
          else seen.set(key, rowNumber);
        }

        if (errors.length === 0) {
          const existing = await userModel.existsByNameOrEmail(userName, userEmail);
          existing.forEach((u) => {
            if (u.user_name.toLowerCase() === userName.toLowerCase()) {
              errors.push({ field: 'User Name', value: userName, error: 'User Name already exists.' });
            }
            if (u.user_email.toLowerCase() === userEmail.toLowerCase()) {
              errors.push({ field: 'User Email ID', value: userEmail, error: 'User Email ID already exists.' });
            }
          });
        }
        return errors;
      },
      saveRow: async (row, db, uploadedBy) => {
        const passwordHash = await bcrypt.hash(row['Password'] || DEFAULT_PASSWORD, 10);
        const created = await userModel.create({
          userName: row['User Name'], userEmail: row['User Email ID'], passwordHash,
          status: row['Status'] || 'Active', createdBy: uploadedBy, uploaded: true,
        }, db);
        await logAudit({ tableName: 'users', recordId: created.user_id, action: 'UPLOAD', actionBy: uploadedBy, newValues: created }, db);
      },
    });

    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} failed.`, data: result });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/sessions  - administrators: who is logged in now
async function listSessions(req, res, next) {
  try {
    const rows = await sessionModel.listOpen();
    res.json({
      success: true,
      data: rows.map((s) => ({ ...s, is_current: s.session_id === req.user.sessionId })),
      idleMinutes: sessionModel.idleMinutes(),
      liveMinutes: sessionModel.liveMinutes(),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/users/sessions/:sid/end  - administrators end a user's login session
async function endSession(req, res, next) {
  try {
    const s = await sessionModel.find(req.params.sid);
    if (!s || s.ended_at) return res.status(404).json({ success: false, message: 'That session has already ended.' });
    if (s.session_id === req.user.sessionId) {
      return res.status(400).json({ success: false, message: 'This is your own session. Use Logout instead.' });
    }
    const user = await userModel.findById(s.user_id);
    await withTransaction(async (db) => {
      await sessionModel.end(s.session_id, 'Ended by administrator', req.user.userName, db);
      await logAudit({
        tableName: 'users', recordId: s.user_id, action: 'SESSION_END', actionBy: req.user.userName,
        details: `Ended ${user.user_name}'s session on ${s.client_label} (${s.ip_address})`,
      }, db);
    });
    res.json({ success: true, message: `${user.user_name}'s session on ${s.client_label} has been ended. They can log in again now.` });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSessions, endSession,
  getAllUsers, createUser, updateUser, resetUserPassword, deleteUser,
  downloadTemplate, exportUsers, bulkUploadUsers,
};
