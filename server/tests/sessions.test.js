// One login session per User ID: refused second login, administrator ending
// sessions, 30-minute idle timeout, closed browsers releasing the login
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('login sessions', () => {
  let ctx;
  const PW = 'Sessionpass123';
  let token;
  const login = () => ctx.api('POST', '/auth/login', { userName: 'clerk', password: PW }, null);
  const sid = async () => (await ctx.pool.query("SELECT session_id FROM user_sessions s JOIN users u USING (user_id) WHERE u.user_name = 'clerk' AND ended_at IS NULL")).rows[0]?.session_id;
  // Moves a session's clock back (minutes ago) instead of waiting
  const age = (column, minutes, id) => ctx.pool.query(`UPDATE user_sessions SET ${column} = NOW() - make_interval(mins => $1) WHERE session_id = $2`, [minutes, id]);

  before(async () => {
    ctx = await setup();
    assert.equal((await ctx.api('POST', '/users', { userName: 'clerk', userEmail: 'clerk@example.test', password: PW })).status, 201);
  });
  after(async () => { await ctx.close(); });

  it('refuses a second login while the first session is live, with where and when', async () => {
    const first = await login();
    assert.equal(first.status, 200);
    token = first.body.token;
    const second = await login();
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'ALREADY_LOGGED_IN');
    assert.match(second.body.message, /User ID "clerk" is already logged in on .+ since .+, last active just now\. Log out there first, or ask an administrator to end that session\./);
    assert.match(second.body.message, /log in again after 3 minutes/);
    assert.equal((await ctx.api('GET', '/auth/me', undefined, token)).status, 200, 'the first session carries on');
    const audit = await ctx.pool.query("SELECT details FROM audit_log WHERE action = 'LOGIN_BLOCKED'");
    assert.equal(audit.rows.length, 1);
  });

  it('lets an administrator see and end a session; the user can then log in again', async () => {
    const list = await ctx.api('GET', '/users/sessions');
    assert.equal(list.status, 200);
    const mine = list.body.data.find((s) => s.user_name === 'clerk');
    assert.ok(mine && mine.responding && mine.client_label);
    assert.ok(list.body.data.find((s) => s.user_name === 'admin').is_current);
    assert.equal((await ctx.api('GET', '/users/sessions', undefined, token)).status, 403, 'administrators only');
    assert.equal((await ctx.api('POST', `/users/sessions/${mine.session_id}/end`, undefined, token)).status, 403);

    const own = list.body.data.find((s) => s.is_current);
    assert.equal((await ctx.api('POST', `/users/sessions/${own.session_id}/end`)).status, 400, 'not your own session');

    const ended = await ctx.api('POST', `/users/sessions/${mine.session_id}/end`);
    assert.equal(ended.status, 200);
    assert.match(ended.body.message, /clerk's session on .+ has been ended/);
    const after = await ctx.api('GET', '/auth/me', undefined, token);
    assert.equal(after.status, 401);
    assert.equal(after.body.reason, 'Ended by administrator');
    assert.match(after.body.message, /An administrator ended your session/);
    assert.equal((await ctx.pool.query("SELECT 1 FROM audit_log WHERE action = 'SESSION_END'")).rows.length, 1);

    const again = await login();
    assert.equal(again.status, 200);
    token = again.body.token;
  });

  it('logs out after 30 minutes without activity; heartbeats alone do not count as activity', async () => {
    const id = await sid();
    await age('last_activity_at', 10, id);
    await age('last_seen_at', 1, id);
    assert.equal((await ctx.api('POST', '/auth/heartbeat', { active: false }, token)).status, 200);
    let s = (await ctx.pool.query('SELECT last_seen_at > NOW() - interval \'5 seconds\' AS seen, last_activity_at < NOW() - interval \'9 minutes\' AS still_idle FROM user_sessions WHERE session_id = $1', [id])).rows[0];
    assert.ok(s.seen && s.still_idle, 'heartbeat without activity keeps the browser "open" but not active');

    await age('last_activity_at', 31, id);
    const idle = await ctx.api('GET', '/auth/me', undefined, token);
    assert.equal(idle.status, 401);
    assert.equal(idle.body.reason, 'Idle timeout');
    assert.match(idle.body.message, /after 30 minutes without activity/);

    const again = await login();
    assert.equal(again.status, 200, 'an idle session does not block a new login');
    token = again.body.token;
    s = (await ctx.pool.query('SELECT last_activity_at > NOW() - interval \'5 seconds\' AS active FROM user_sessions WHERE session_id = $1', [await sid()])).rows[0];
    assert.ok(s.active);
  });

  it('frees the login a few minutes after the browser was closed (no heartbeat)', async () => {
    const id = await sid();
    await age('last_seen_at', 2, id);
    assert.equal((await login()).status, 409, 'still within 3 minutes');
    await age('last_seen_at', 4, id);
    const again = await login();
    assert.equal(again.status, 200);
    const old = await ctx.api('GET', '/auth/me', undefined, token);
    assert.equal(old.status, 401, 'the closed browser\'s session is over');
    token = again.body.token;
  });

  it('frees the login immediately on logout; a password change keeps the current session', async () => {
    const changed = await ctx.api('POST', '/auth/change-password', { currentPassword: PW, newPassword: `${PW}9` }, token);
    assert.equal(changed.status, 200);
    assert.equal((await ctx.api('GET', '/auth/me', undefined, token)).status, 401, 'old token of the session refused');
    const fresh = changed.body.token;
    assert.equal((await ctx.api('GET', '/auth/me', undefined, fresh)).status, 200, 'session carries on with the new token');

    assert.equal((await ctx.api('POST', '/auth/logout', undefined, fresh)).status, 200);
    const again = await ctx.api('POST', '/auth/login', { userName: 'clerk', password: `${PW}9` }, null);
    assert.equal(again.status, 200);
  });

  it('ends the sessions of a deactivated user', async () => {
    const id = (await ctx.pool.query("SELECT user_id FROM users WHERE user_name = 'clerk'")).rows[0].user_id;
    await ctx.api('PUT', `/users/${id}`, { userName: 'clerk', userEmail: 'clerk@example.test', status: 'Inactive' });
    const open = await ctx.pool.query('SELECT end_reason FROM user_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1', [id]);
    assert.equal(open.rows[0].end_reason, 'User deactivated');
  });
});
