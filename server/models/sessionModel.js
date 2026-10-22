/**
 * Login sessions (one live session per User ID).
 *  - live: not ended, heard from within SESSION_LIVE_MINUTES (heartbeat every minute
 *    while the app is open; a closed browser stops) and active within
 *    SESSION_IDLE_MINUTES (idle timeout, default 30)
 *  - a session idle for longer is ended ('Idle timeout') on its next request
 */
const crypto = require('crypto');
const { pool } = require('../config/db');

const idleMinutes = () => Number(process.env.SESSION_IDLE_MINUTES) || 30;
const liveMinutes = () => Number(process.env.SESSION_LIVE_MINUTES) || 3;

// 'Chrome on Windows', 'SD Maintenance app on Windows', ...
function describeAgent(ua = '') {
  const browser = /Electron\//.test(ua) ? 'SD Maintenance app'
    : /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

// '::ffff:172.30.10.45' -> '172.30.10.45'; '::1' -> 'this PC'
function cleanIp(ip = '') {
  const v = String(ip).replace(/^::ffff:/, '');
  return v === '::1' || v === '127.0.0.1' ? 'this PC' : v;
}

const WITH_STATE = `*,
  last_activity_at < NOW() - make_interval(mins => $2::int) AS idle,
  last_seen_at > NOW() - make_interval(mins => $3::int) AS responding`;

// The user's live session, if any
async function liveSession(userId, db = pool) {
  return (await db.query(
    `SELECT ${WITH_STATE} FROM user_sessions
     WHERE user_id = $1 AND ended_at IS NULL
       AND last_seen_at > NOW() - make_interval(mins => $3::int)
       AND last_activity_at > NOW() - make_interval(mins => $2::int)
     ORDER BY last_seen_at DESC LIMIT 1`,
    [userId, idleMinutes(), liveMinutes()]
  )).rows[0] || null;
}

// New session; earlier open (no longer live) sessions of the user are closed
async function start({ userId, ip, userAgent }, db = pool) {
  await db.query(
    `UPDATE user_sessions SET ended_at = NOW(), end_reason = 'Expired (not in use)'
     WHERE user_id = $1 AND ended_at IS NULL`,
    [userId]
  );
  return (await db.query(
    `INSERT INTO user_sessions (session_id, user_id, ip_address, user_agent, client_label)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [crypto.randomUUID(), userId, cleanIp(ip), String(userAgent || '').slice(0, 400), describeAgent(userAgent)]
  )).rows[0];
}

async function find(sessionId, db = pool) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return null;
  return (await db.query(`SELECT ${WITH_STATE} FROM user_sessions WHERE session_id = $1`,
    [sessionId, idleMinutes(), liveMinutes()])).rows[0] || null;
}

// Marks the session as heard from (and active unless only a heartbeat without
// activity); written at most every 15 seconds per session
async function touch(sessionId, active, db = pool) {
  await db.query(
    `UPDATE user_sessions
     SET last_seen_at = NOW(), last_activity_at = CASE WHEN $2 THEN NOW() ELSE last_activity_at END
     WHERE session_id = $1
       AND (last_seen_at < NOW() - interval '15 seconds' OR ($2 AND last_activity_at < NOW() - interval '15 seconds'))`,
    [sessionId, Boolean(active)]
  );
}

async function end(sessionId, reason, by = null, db = pool) {
  return (await db.query(
    `UPDATE user_sessions SET ended_at = NOW(), end_reason = $2, ended_by = $3
     WHERE session_id = $1 AND ended_at IS NULL RETURNING *`,
    [sessionId, reason, by]
  )).rows[0] || null;
}

// Ends every open session of a user (except one, e.g. the session changing its password)
async function endForUser(userId, reason, by = null, { except = null } = {}, db = pool) {
  return (await db.query(
    `UPDATE user_sessions SET ended_at = NOW(), end_reason = $2, ended_by = $3
     WHERE user_id = $1 AND ended_at IS NULL AND ($4::uuid IS NULL OR session_id <> $4::uuid) RETURNING session_id`,
    [userId, reason, by, except]
  )).rows.length;
}

// Open sessions within the idle timeout, for User Master
async function listOpen(db = pool) {
  return (await db.query(
    `SELECT s.session_id, s.user_id, u.user_name, u.user_email, u.is_admin, s.started_at, s.last_seen_at, s.last_activity_at,
            s.ip_address, s.client_label,
            s.last_seen_at > NOW() - make_interval(mins => $2::int) AS responding,
            EXTRACT(EPOCH FROM NOW() - s.last_activity_at)::int AS idle_seconds
     FROM user_sessions s JOIN users u ON u.user_id = s.user_id
     WHERE s.ended_at IS NULL AND s.last_activity_at > NOW() - make_interval(mins => $1::int)
     ORDER BY u.user_name, s.started_at`,
    [idleMinutes(), liveMinutes()]
  )).rows;
}

module.exports = {
  idleMinutes, liveMinutes, describeAgent, cleanIp, liveSession, start, find, touch, end, endForUser, listOpen,
};
