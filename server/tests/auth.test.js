// Login, sessions, password rules and User Rights enforcement
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('authentication and rights', () => {
  let ctx;
  const PW = 'Userpass123';
  let userId;
  let userToken;

  before(async () => { ctx = await setup(); });
  after(async () => { await ctx.close(); });

  it('keeps /api/health public and rejects bad tokens with 401', async () => {
    assert.equal((await ctx.api('GET', '/health', undefined, null)).status, 200);
    assert.equal((await ctx.api('GET', '/cost-centers', undefined, 'garbage')).status, 401);
    assert.equal((await ctx.api('GET', '/cost-centers', undefined, null)).status, 401);
  });

  it('returns the admin session with every right', async () => {
    const me = await ctx.api('GET', '/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.isAdmin, true);
    assert.ok(me.body.user.rights.length >= 9);
    assert.ok(me.body.user.rights.every((r) => r.canView && r.canUpload));
  });

  it('rejects wrong passwords and weak new passwords', async () => {
    assert.equal((await ctx.api('POST', '/auth/login', { userName: 'admin', password: 'nope' }, null)).status, 401);
    const weak = await ctx.api('POST', '/users', { userName: 'weak', userEmail: 'weak@example.test', password: 'short' });
    assert.equal(weak.status, 400);
  });

  it('gives a new user no access until rights are assigned', async () => {
    const created = await ctx.api('POST', '/users', { userName: 'clerk', userEmail: 'clerk@example.test', password: PW });
    assert.equal(created.status, 201);
    userId = created.body.data.user_id;
    userToken = await ctx.login('clerk', PW);
    const me = await ctx.api('GET', '/auth/me', undefined, userToken);
    assert.ok(me.body.user.rights.every((r) => !r.canView));
    assert.equal((await ctx.api('GET', '/cost-centers', undefined, userToken)).status, 403);
  });

  it('enforces each right flag; any right implies View', async () => {
    const saved = await ctx.api('PUT', `/user-rights/${userId}`, { rights: [{ screenCode: 'COST_CENTER', canEdit: true }] });
    assert.equal(saved.status, 200);
    assert.equal((await ctx.api('GET', '/cost-centers', undefined, userToken)).status, 200);
    assert.equal((await ctx.api('POST', '/cost-centers', { name: 'Nope' }, userToken)).status, 403);
    assert.equal((await ctx.api('GET', '/cost-centers/template', undefined, userToken)).status, 403);
    const again = await ctx.api('PUT', `/user-rights/${userId}`, { rights: [{ screenCode: 'COST_CENTER', canEdit: true }] });
    assert.equal(again.body.message, 'No changes to save.');
    assert.equal((await ctx.api('PUT', `/user-rights/${userId}`, { rights: [{ screenCode: 'BOGUS' }] })).status, 400);
  });

  it('protects administrator accounts', async () => {
    const admin = (await ctx.api('GET', '/users?search=admin')).body.data[0];
    assert.equal((await ctx.api('PUT', `/user-rights/${admin.user_id}`, { rights: [{ screenCode: 'USER', canView: false }] })).status, 400);
    assert.equal((await ctx.api('DELETE', `/users/${admin.user_id}`)).status, 400);
    assert.equal((await ctx.api('PUT', `/users/${admin.user_id}`, { userName: 'admin', userEmail: 'admin@example.test', status: 'Inactive' })).status, 400);
  });

  it('ends other sessions on password change, keeps the current one', async () => {
    const changed = await ctx.api('POST', '/auth/change-password', { currentPassword: PW, newPassword: `${PW}x` }, userToken);
    assert.equal(changed.status, 200);
    assert.equal((await ctx.api('GET', '/auth/me', undefined, userToken)).status, 401);
    userToken = changed.body.token;
    assert.equal((await ctx.api('GET', '/auth/me', undefined, userToken)).status, 200);
    const wrong = await ctx.api('POST', '/auth/change-password', { currentPassword: 'bad', newPassword: 'Another123' }, userToken);
    assert.equal(wrong.status, 400);
  });

  it('ends sessions on deactivation and logout; inactive users cannot log in', async () => {
    // A second admin login is refused while the first session is live (one session per User ID)
    assert.equal((await ctx.api('POST', '/auth/login', { userName: 'admin', password: ctx.adminPassword }, null)).status, 409);
    const other = ctx.adminToken;
    await ctx.api('PUT', `/users/${userId}`, { userName: 'clerk', userEmail: 'clerk@example.test', status: 'Inactive' });
    assert.equal((await ctx.api('GET', '/auth/me', undefined, userToken)).status, 401);
    const login = await ctx.api('POST', '/auth/login', { userName: 'clerk', password: `${PW}x` }, null);
    assert.equal(login.status, 403);
    assert.equal((await ctx.api('POST', '/auth/logout', undefined, other)).status, 200);
    assert.equal((await ctx.api('GET', '/auth/me', undefined, other)).status, 401);
    ctx.adminToken = await ctx.login('admin', ctx.adminPassword);
  });

  it('lets an administrator reset a password', async () => {
    const reset = await ctx.api('PUT', `/users/${userId}/password`, { newPassword: 'Resetpass99' });
    assert.equal(reset.status, 200);
    await ctx.api('PUT', `/users/${userId}`, { userName: 'clerk', userEmail: 'clerk@example.test', status: 'Active' });
    assert.ok(await ctx.login('clerk', 'Resetpass99'));
  });

  it('writes logins, rights and password changes to the audit log', async () => {
    const { rows } = await ctx.pool.query('SELECT DISTINCT action FROM audit_log');
    const actions = rows.map((r) => r.action);
    ['LOGIN', 'LOGOUT', 'RIGHTS_CHANGE', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'STATUS_CHANGE', 'INSERT'].forEach((a) => {
      assert.ok(actions.includes(a), `missing ${a}`);
    });
    const leak = await ctx.pool.query("SELECT 1 FROM audit_log WHERE new_values::text LIKE '%password_hash%' OR old_values::text LIKE '%password_hash%'");
    assert.equal(leak.rows.length, 0, 'password hashes must not reach the audit log');
  });
});
