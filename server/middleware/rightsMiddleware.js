const userRightsModel = require('../models/userRightsModel');

// Screen codes - must match rows in the `screens` table
const SCREENS = {
  COST_CENTER: 'COST_CENTER',
  USER: 'USER',
  USER_RIGHTS: 'USER_RIGHTS',
  LOCATION: 'LOCATION',
  SD_MASTER: 'SD_MASTER',
  SD_TRANSACTION: 'SD_TRANSACTION',
  SD_REPORT: 'SD_REPORT',
  EMAIL_LOG: 'EMAIL_LOG',
  AUDIT_LOG: 'AUDIT_LOG',
  NOTIFICATION: 'NOTIFICATION',
  SD_DASHBOARD: 'SD_DASHBOARD',
};

// Route guard: requireRight(SCREENS.USER, 'edit'). Must run after
// authenticateToken. Admin users pass every check.
function requireRight(screenCode, action) {
  return async (req, res, next) => {
    try {
      if (req.user.isAdmin || (await userRightsModel.hasRight(req.user.userId, screenCode, action))) {
        return next();
      }
      res.status(403).json({
        success: false,
        message: `You do not have ${action} permission for this screen.`,
      });
    } catch (err) {
      next(err);
    }
  };
}

// Route guard for administrator-only actions. Must run after authenticateToken.
function requireAdmin(req, res, next) {
  if (req.user.isAdmin) return next();
  res.status(403).json({ success: false, message: 'Only administrators can do this.' });
}

module.exports = { SCREENS, requireRight, requireAdmin };
