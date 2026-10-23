const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const userModel = require('../models/userModel');
const sessionModel = require('../models/sessionModel');
const userRightsModel = require('../models/userRightsModel');
const { sendPasswordResetEmail } = require('../utils/emailService');
const { logAudit } = require('../utils/audit');
const { passwordPolicyError } = require('../utils/validators');

// sid = the login session (user_sessions) this token belongs to
function signToken(user, tokenVersion, sid) {
  return jwt.sign(
    { userId: user.user_id, userName: user.user_name, tokenVersion, sid },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// What the client needs to build its menu and enable buttons
async function sessionUser(user) {
  return {
    userId: user.user_id,
    userName: user.user_name,
    userEmail: user.user_email,
    isAdmin: user.is_admin,
    rights: await userRightsModel.getForUser(user.user_id, user.is_admin),
  };
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { userName, password } = req.body;
    if (!userName || !password) {
      return res.status(400).json({ success: false, message: 'User Name and Password are required.' });
    }

    const user = await userModel.findByUserName(userName);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid User Name or Password.' });
    }

    // Locked for a while after repeated wrong passwords (LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES)
    const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
    const lockMinutes = Number(process.env.LOGIN_LOCK_MINUTES) || 15;
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const left = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return res.status(423).json({
        success: false, code: 'ACCOUNT_LOCKED',
        message: `This account is locked after ${maxAttempts} wrong passwords. Try again in ${left} minute(s), or ask an administrator to reset the password.`,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const failed = (await pool.query(
        `UPDATE users SET failed_logins = failed_logins + 1,
                locked_until = CASE WHEN failed_logins + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
         WHERE user_id = $1 RETURNING failed_logins, locked_until`,
        [user.user_id, maxAttempts, lockMinutes]
      )).rows[0];
      if (failed.failed_logins >= maxAttempts) {
        await pool.query('UPDATE users SET failed_logins = 0 WHERE user_id = $1', [user.user_id]);
        await logAudit({ tableName: 'users', recordId: user.user_id, action: 'LOGIN_LOCKED', actionBy: user.user_name, details: `${maxAttempts} wrong passwords; locked for ${lockMinutes} minutes (${sessionModel.cleanIp(req.ip)})` });
        return res.status(423).json({
          success: false, code: 'ACCOUNT_LOCKED',
          message: `Too many wrong passwords. This account is locked for ${lockMinutes} minutes, or until an administrator resets the password.`,
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid User Name or Password.' });
    }
    if (user.failed_logins || user.locked_until) {
      await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE user_id = $1', [user.user_id]);
    }

    // Only Active users may log in (checked after the password so the
    // message does not reveal which user names exist)
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact the administrator.' });
    }

    // One live session per User ID: refuse while another browser / PC has one.
    // The advisory lock stops two simultaneous logins from both getting in.
    const result = await withTransaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(7300, $1)', [user.user_id]);
      const live = await sessionModel.liveSession(user.user_id, db);
      if (live) return { live };
      const session = await sessionModel.start({ userId: user.user_id, ip: req.ip, userAgent: req.get('user-agent') }, db);
      await logAudit({
        tableName: 'users', recordId: user.user_id, action: 'LOGIN', actionBy: user.user_name,
        details: `${session.client_label}, ${session.ip_address}`,
      }, db);
      return { session };
    });

    if (result.live) {
      const s = result.live;
      const since = new Date(s.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
      const idleMin = Math.floor((Date.now() - new Date(s.last_activity_at).getTime()) / 60000);
      await logAudit({
        tableName: 'users', recordId: user.user_id, action: 'LOGIN_BLOCKED', actionBy: user.user_name,
        details: `Already logged in on ${s.client_label} (${s.ip_address}); attempt from ${sessionModel.describeAgent(req.get('user-agent'))} (${sessionModel.cleanIp(req.ip)})`,
      });
      return res.status(409).json({
        success: false,
        code: 'ALREADY_LOGGED_IN',
        message: `User ID "${user.user_name}" is already logged in on ${s.client_label} (${s.ip_address}) since ${since}`
          + `, last active ${idleMin < 1 ? 'just now' : `${idleMin} minute(s) ago`}. Log out there first, or ask an administrator to end that session.`
          + ` If that browser was closed without logging out, you can log in again after ${sessionModel.liveMinutes()} minutes.`,
      });
    }

    res.json({
      success: true,
      message: 'Login successful.',
      token: signToken(user, user.token_version, result.session.session_id),
      user: await sessionUser(user),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout  - ends every session of the current user
async function logout(req, res, next) {
  try {
    await withTransaction(async (db) => {
      await sessionModel.endForUser(req.user.userId, 'Logged out', req.user.userName, {}, db);
      await userModel.bumpTokenVersion(req.user.userId, db);
      await logAudit({ tableName: 'users', recordId: req.user.userId, action: 'LOGOUT', actionBy: req.user.userName }, db);
    });
    res.json({ success: true, message: 'Logged out.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res, next) {
  try {
    const { userEmail } = req.body;
    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'User Email ID is required.' });
    }

    const user = await userModel.findByEmail(userEmail);
    // Respond generically whether or not the user exists (avoid leaking which emails are registered)
    const genericResponse = {
      success: true,
      message: 'If the email is registered and active, a password reset link has been sent.',
    };

    if (!user || user.status !== 'Active') {
      return res.json(genericResponse);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresMinutes = parseInt(process.env.RESET_TOKEN_EXPIRES_MINUTES, 10) || 30;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.user_id, resetToken, expiresAt]
    );

    const resetLink = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    await sendPasswordResetEmail(user.user_email, user.user_name, resetLink);

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/reset-password/:token
async function resetPassword(req, res, next) {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      return res.status(400).json({ success: false, message: policyError });
    }

    const result = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token=$1 AND used=FALSE AND expires_at > NOW()',
      [token]
    );

    const resetRecord = result.rows[0];
    if (!resetRecord) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await withTransaction(async (db) => {
      const user = await userModel.findById(resetRecord.user_id, db);
      await userModel.updatePassword(resetRecord.user_id, passwordHash, user.user_name, db);
      await sessionModel.endForUser(resetRecord.user_id, 'Password reset', user.user_name, {}, db);
      // Single use: this link and any other outstanding links for the user
      await db.query('UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1 AND used=FALSE', [resetRecord.user_id]);
      await logAudit({
        tableName: 'users', recordId: resetRecord.user_id, action: 'PASSWORD_RESET',
        actionBy: user.user_name, details: 'Reset via emailed link',
      }, db);
    });

    res.json({ success: true, message: 'Password has been reset successfully. You may now log in.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/change-password
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }

    const user = await userModel.findById(req.user.userId);
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      return res.status(400).json({ success: false, message: policyError });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from the current password.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const tokenVersion = await withTransaction(async (db) => {
      const version = await userModel.updatePassword(user.user_id, passwordHash, user.user_name, db);
      await sessionModel.endForUser(user.user_id, 'Password changed', user.user_name, { except: req.user.sessionId }, db);
      await logAudit({ tableName: 'users', recordId: user.user_id, action: 'PASSWORD_CHANGE', actionBy: user.user_name }, db);
      return version;
    });

    // Other sessions end; this one continues with a fresh token
    res.json({
      success: true,
      message: 'Password changed successfully.',
      token: signToken(user, tokenVersion, req.user.sessionId),
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me  (verify token / fetch current user and rights)
async function getMe(req, res, next) {
  try {
    const user = await userModel.findById(req.user.userId);
    res.json({ success: true, user: await sessionUser(user) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/heartbeat { active }  - sent every minute while the app is open;
// keeps the session live (the check itself is in authenticateToken)
function heartbeat(req, res) {
  res.json({ success: true });
}

module.exports = { login, logout, forgotPassword, resetPassword, changePassword, getMe, heartbeat };
