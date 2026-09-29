// Mail server (SMTP) and sender settings on the Email Notification Master
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createMasters, sdBody } = require('./helpers');
const { encrypt, decrypt } = require('../utils/secret');

describe('mail server settings', () => {
  let ctx;
  const form = (o = {}) => ({
    smtp_host: 'smtp.example.test', smtp_port: '587', smtp_secure: false, smtp_user: 'mailer@example.test',
    password: '', from_name: 'SD Maintenance', from_email: 'no-reply@example.test',
    default_recipients: 'leases@example.test, finance@example.test', ...o,
  });

  before(async () => { ctx = await setup(); });
  after(async () => { await ctx.close(); });

  it('encrypts secrets reversibly', () => {
    const enc = encrypt('S3cret!');
    assert.notEqual(enc, 'S3cret!');
    assert.equal(decrypt(enc), 'S3cret!');
    assert.equal(decrypt('v1:bad:data:here'), null);
  });

  it('shows .env values behind blank fields and never a password', async () => {
    const res = await ctx.api('GET', '/mail-settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.smtp_host, '');
    assert.equal(res.body.data.env.default_recipients, 'qa-team@example.test');
    assert.equal(res.body.data.dry_run, true);
    assert.ok(!('password' in res.body.data) && !('smtp_password_enc' in res.body.data));
  });

  it('is limited to administrators, even with template rights', async () => {
    const u = (await ctx.api('POST', '/users', { userName: 'mail.editor', userEmail: 'mail.editor@example.test', password: 'Editpass123' })).body.data;
    await ctx.api('PUT', `/user-rights/${u.user_id}`, { rights: [{ screenCode: 'NOTIFICATION', canView: true, canEdit: true }] });
    const token = await ctx.login('mail.editor', 'Editpass123');
    assert.equal((await ctx.api('GET', '/notification-templates', undefined, token)).status, 200);
    assert.equal((await ctx.api('GET', '/mail-settings', undefined, token)).status, 403);
    assert.equal((await ctx.api('PUT', '/mail-settings', form(), token)).status, 403);
    assert.equal((await ctx.api('POST', '/mail-settings/test', { ...form(), to: 'x@example.test' }, token)).status, 403);
  });

  it('validates port, host and addresses', async () => {
    const res = await ctx.api('PUT', '/mail-settings', form({ smtp_port: '99999', smtp_host: 'bad host!', from_email: 'nope', default_recipients: 'ok@example.test, bad' }));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.errors.map((e) => e.field).sort(), ['Default recipients', 'Port', 'SMTP server', 'Sender email']);
  });

  it('stores the password encrypted and keeps it out of responses and the audit log', async () => {
    const res = await ctx.api('PUT', '/mail-settings', form({ password: 'Sm7pPass!' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.has_password, true);
    assert.ok(!JSON.stringify(res.body).includes('Sm7pPass!'));
    const row = (await ctx.pool.query('SELECT smtp_password_enc FROM mail_settings')).rows[0];
    assert.ok(row.smtp_password_enc.startsWith('v1:') && !row.smtp_password_enc.includes('Sm7pPass!'));
    assert.equal(decrypt(row.smtp_password_enc), 'Sm7pPass!');
    const audit = (await ctx.api('GET', '/logs/audit?tableName=mail_settings')).body.data[0];
    assert.match(audit.details, /SMTP password changed/);
    assert.ok(!JSON.stringify(audit).includes('smtp_password_enc') && !JSON.stringify(audit).includes('Sm7pPass!'));

    // Saving again with a blank password keeps it
    await ctx.api('PUT', '/mail-settings', form({ from_name: 'SD Team' }));
    const kept = (await ctx.pool.query('SELECT smtp_password_enc FROM mail_settings')).rows[0];
    assert.equal(decrypt(kept.smtp_password_enc), 'Sm7pPass!');
  });

  it('uses the saved default recipients for notifications with a blank To', async () => {
    const m = await createMasters(ctx);
    await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'MS-1', leaseCommencementDate: '01/01/2020', leaseEndDate: '10/01/2030' }));
    const run = await ctx.api('POST', '/notifications/run-reminders', { asOf: '01/01/2030' });
    assert.equal(run.body.data.sent, 1);
    const log = (await ctx.api('GET', '/logs/email?notificationType=LEASE_END_REMINDER')).body.data[0];
    assert.equal(log.recipient, 'leases@example.test, finance@example.test');
    const tpl = await ctx.api('GET', '/notification-templates');
    assert.equal(tpl.body.defaultRecipients, 'leases@example.test, finance@example.test');
  });

  it('sends a test email (logged as dry run here)', async () => {
    assert.equal((await ctx.api('POST', '/mail-settings/test', { ...form(), to: 'not-an-email' })).status, 400);
    const res = await ctx.api('POST', '/mail-settings/test', { ...form(), to: 'me@example.test' });
    assert.equal(res.status, 200);
    assert.match(res.body.message, /Dry-run mode is on/);
    const log = (await ctx.api('GET', '/logs/email?notificationType=TEST_EMAIL')).body.data[0];
    assert.equal(log.recipient, 'me@example.test');
    assert.equal(log.status, 'DryRun');
  });

  it('clears the stored password back to the .env value', async () => {
    const res = await ctx.api('PUT', '/mail-settings', form({ clear_password: true }));
    assert.equal(res.body.data.has_password, false);
    assert.equal((await ctx.pool.query('SELECT smtp_password_enc FROM mail_settings')).rows[0].smtp_password_enc, null);
  });
});
