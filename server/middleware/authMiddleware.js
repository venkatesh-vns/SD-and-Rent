const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const sessionModel = require('../models/sessionModel');

// What the login screen tells the user when their session has ended
function endedMessage(reason) {
  if (reason === 'Idle timeout') return `You were logged out after ${sessionModel.idleMinutes()} minutes without activity. Please log in again.`;
  if (reason === 'Ended by administrator') return 'An administrator ended your session. Please log in again.';
  return 'Your session has ended. Please log in again.';
}
const unauthorized = (res, reason) => res.status(401).json({ success: false, message: endedMessage(reason), reason: reason || 'Session ended' });

// Verifies the JWT sent in the Authorization header (Bearer token), then
// re-checks the user and the login session on every request, so deactivation,
// logout, password changes, an administrator ending the session and the idle
// timeout take effect immediately. Each request marks the session as in use
// (a heartbeat without user activity only shows the browser is still open).
// Attaches { userId, userName, userEmail, isAdmin, sessionId } to req.user.
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token is required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return unauthorized(res);
  }

  try {
    const session = await sessionModel.find(decoded.sid);
    if (!session || session.user_id !== decoded.userId) return unauthorized(res);
    if (session.ended_at) return unauthorized(res, session.end_reason);
    if (session.idle) {
      await sessionModel.end(session.session_id, 'Idle timeout');
      return unauthorized(res, 'Idle timeout');
    }

    const user = await userModel.findById(decoded.userId);
    // An older token of the session (e.g. from before a password change) is refused;
    // deactivation, logout and password resets end the session record themselves
    if (!user || user.status !== 'Active' || user.token_version !== decoded.tokenVersion) {
      return unauthorized(res);
    }

    const heartbeat = req.originalUrl.startsWith('/api/auth/heartbeat');
    await sessionModel.touch(session.session_id, heartbeat ? req.body?.active === true : true);
    req.user = {
      userId: user.user_id,
      userName: user.user_name,
      userEmail: user.user_email,
      isAdmin: user.is_admin,
      sessionId: session.session_id,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticateToken };
