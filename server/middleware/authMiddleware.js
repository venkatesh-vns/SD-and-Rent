const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

// Verifies the JWT sent in the Authorization header (Bearer token), then
// re-checks the user on every request so that deactivation, logout and
// password changes end existing sessions immediately.
// Attaches { userId, userName, userEmail, isAdmin } to req.user.
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
    return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  }

  try {
    const user = await userModel.findById(decoded.userId);
    if (!user || user.status !== 'Active' || user.token_version !== decoded.tokenVersion) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    req.user = {
      userId: user.user_id,
      userName: user.user_name,
      userEmail: user.user_email,
      isAdmin: user.is_admin,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticateToken };
