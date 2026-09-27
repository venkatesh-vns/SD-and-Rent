const { withTransaction } = require('../config/db');
const userModel = require('../models/userModel');
const userRightsModel = require('../models/userRightsModel');
const { logAudit } = require('../utils/audit');

const FLAGS = ['canView', 'canAdd', 'canEdit', 'canDelete', 'canUpload'];

// GET /api/user-rights/users?search=  - users to pick from (needs only User Rights View)
async function getUsers(req, res, next) {
  try {
    const users = await userModel.getAll({ search: req.query.search });
    res.json({
      success: true,
      data: users.map((u) => ({ user_id: u.user_id, user_name: u.user_name, user_email: u.user_email, status: u.status, is_admin: u.is_admin })),
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/user-rights/screens
async function getScreens(req, res, next) {
  try {
    res.json({ success: true, data: await userRightsModel.getScreens() });
  } catch (err) {
    next(err);
  }
}

// GET /api/user-rights/:userId
async function getUserRights(req, res, next) {
  try {
    const user = await userModel.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({
      success: true,
      data: {
        userId: user.user_id,
        userName: user.user_name,
        isAdmin: user.is_admin,
        rights: await userRightsModel.getForUser(user.user_id, user.is_admin),
      },
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/user-rights/:userId   body: { rights: [{ screenCode, canView, canAdd, ... }] }
async function saveUserRights(req, res, next) {
  try {
    const user = await userModel.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.is_admin) {
      return res.status(400).json({ success: false, message: 'Administrator accounts always have full access.' });
    }

    const { rights } = req.body;
    if (!Array.isArray(rights) || rights.length === 0) {
      return res.status(400).json({ success: false, message: 'No rights supplied.' });
    }

    const validScreens = new Set((await userRightsModel.getScreens()).map((s) => s.screen_code));
    const unknown = rights.filter((r) => !validScreens.has(r.screenCode)).map((r) => r.screenCode);
    if (unknown.length > 0) {
      return res.status(400).json({ success: false, message: `Unknown screen(s): ${unknown.join(', ')}` });
    }

    const changed = await withTransaction(async (db) => {
      let count = 0;
      for (const input of rights) {
        const right = { screenCode: input.screenCode };
        FLAGS.forEach((f) => { right[f] = Boolean(input[f]); });
        // Any other permission on a screen implies being able to open it
        if (right.canAdd || right.canEdit || right.canDelete || right.canUpload) right.canView = true;

        const before = await userRightsModel.findRow(user.user_id, right.screenCode, db);
        const same = before
          && before.can_view === right.canView && before.can_add === right.canAdd && before.can_edit === right.canEdit
          && before.can_delete === right.canDelete && before.can_upload === right.canUpload;
        const allFalse = FLAGS.every((f) => !right[f]);
        if (same || (!before && allFalse)) continue;

        const after = await userRightsModel.upsert(user.user_id, right, req.user.userName, db);
        await logAudit({
          tableName: 'user_rights', recordId: after.user_right_id, action: 'RIGHTS_CHANGE',
          actionBy: req.user.userName, oldValues: before || null, newValues: after,
          details: `${user.user_name} / ${right.screenCode}`,
        }, db);
        count++;
      }
      return count;
    });

    res.json({
      success: true,
      message: changed === 0 ? 'No changes to save.' : `Rights saved for ${user.user_name} (${changed} screen(s) changed).`,
      data: await userRightsModel.getForUser(user.user_id, false),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getUsers, getScreens, getUserRights, saveUserRights };
