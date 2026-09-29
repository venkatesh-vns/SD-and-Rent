// Email Notification Master: editable templates, recipients, trigger days
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createMasters, sdBody } = require('./helpers');

describe('email notification templates', () => {
  let ctx;
  let m;

  before(async () => {
    ctx = await setup();
    m = await createMasters(ctx);
  });
  after(async () => { await ctx.close(); });

  const lease = (o = {}) => ({
    is_enabled: true, to_recipients: '', cc_recipients: '', days_before: 15,
    subject: 'Reminder: {{sd_code}} Lease End Date on {{due_date}}',
    body: 'Dear Team,\n\n{{sd_code}} ends on {{due_date}} ({{days_left_text}}).',
    include_details: true, ...o,
  });

  it('lists the five notifications with default settings', async () => {
    const res = await ctx.api('GET', '/notification-templates');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((t) => t.notification_type), [
      'LEASE_COMMENCEMENT_REMINDER', 'RENT_COMMENCEMENT_REMINDER', 'LEASE_END_REMINDER',
      'LANDLORD_STATUS_PASSIVE', 'BUILDING_STATUS_PASSIVE',
    ]);
    const leaseEnd = res.body.data[2];
    assert.equal(leaseEnd.days_before, 15);
    assert.equal(leaseEnd.is_enabled, true);
    assert.ok(leaseEnd.placeholders.due_date);
    assert.equal(res.body.data[3].days_before, null);
    assert.ok(!res.body.data[3].placeholders.due_date && res.body.data[3].placeholders.changed_by);
  });

  it('rejects unknown placeholders, bad emails and bad trigger days', async () => {
    const bad = await ctx.api('PUT', '/notification-templates/LEASE_END_REMINDER', lease({
      subject: 'Hi {{nope}}', to_recipients: 'ok@example.test, not-an-email', days_before: 400,
    }));
    assert.equal(bad.status, 400);
    const fields = bad.body.errors.map((e) => e.field).sort();
    assert.deepEqual(fields, ['Subject', 'To', 'Trigger days']);
    const statusDays = await ctx.api('PUT', '/notification-templates/LANDLORD_STATUS_PASSIVE', {
      ...lease(), subject: 'X {{due_date}}', body: 'y',
    });
    assert.match(statusDays.body.message, /Unknown placeholder\(s\): \{\{due_date\}\}/, 'reminder-only field not allowed on status emails');
  });

  it('previews with sample data, escaping values', async () => {
    const res = await ctx.api('POST', '/notification-templates/LEASE_END_REMINDER/preview', lease({
      days_before: 30, body: '<b>Hi</b> {{landlord_name}}\nline two', include_details: false,
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.subject, 'Reminder: SD000123 Lease End Date on 31/03/2031');
    assert.match(res.body.data.html, /&lt;b&gt;Hi&lt;\/b&gt; Lakshmi Estates Pvt Ltd<br>line two/);
    assert.ok(!res.body.data.html.includes('<table'), 'details table left out');
    assert.equal(res.body.data.to, 'qa-team@example.test', 'blank To falls back to the default mailbox');
  });

  it('uses the saved trigger days, recipients, CC and wording for reminders', async () => {
    const saved = await ctx.api('PUT', '/notification-templates/LEASE_END_REMINDER', lease({
      days_before: 30, to_recipients: 'leases@example.test; finance@example.test', cc_recipients: 'head@example.test',
      subject: 'Lease ending: {{sd_code}} on {{due_date}} ({{days_left}} days)',
    }));
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.to_recipients, 'leases@example.test, finance@example.test');

    // 25 days ahead: outside the default 15, inside the new 30
    await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'T-25', leaseCommencementDate: '01/01/2020', leaseEndDate: '26/01/2030' }));
    const run = await ctx.api('POST', '/notifications/run-reminders', { asOf: '01/01/2030' });
    assert.equal(run.body.data.sent, 1);
    const log = (await ctx.api('GET', '/logs/email?notificationType=LEASE_END_REMINDER')).body.data[0];
    assert.match(log.subject, /^Lease ending: SD\d{6} on 26\/01\/2030 \(25 days\)$/);
    assert.equal(log.recipient, 'leases@example.test, finance@example.test; cc: head@example.test');

    const audit = (await ctx.api('GET', '/logs/audit?tableName=notification_templates')).body;
    assert.ok(audit.total >= 1);
  });

  it('sends nothing for a switched-off notification', async () => {
    const tplRes = (await ctx.api('GET', '/notification-templates')).body.data.find((t) => t.notification_type === 'LANDLORD_STATUS_PASSIVE');
    await ctx.api('PUT', '/notification-templates/LANDLORD_STATUS_PASSIVE', { ...tplRes, is_enabled: false });
    const sd = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'T-OFF' }))).body.data;
    await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdBody(m, { leaseId: 'T-OFF', landlordStatus: 'Passive' }));
    assert.equal((await ctx.api('GET', '/logs/email?notificationType=LANDLORD_STATUS_PASSIVE')).body.total, 0);

    await ctx.api('PUT', '/notification-templates/LANDLORD_STATUS_PASSIVE', { ...tplRes, is_enabled: true });
    await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdBody(m, { leaseId: 'T-OFF' }));
    await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdBody(m, { leaseId: 'T-OFF', landlordStatus: 'Passive' }));
    const sent = (await ctx.api('GET', '/logs/email?notificationType=LANDLORD_STATUS_PASSIVE')).body;
    assert.equal(sent.total, 1, 'switched back on, it sends again');
    assert.match(sent.data[0].subject, /Landlord Status changed to Passive/);
  });

  it('restores the default template', async () => {
    const res = await ctx.api('POST', '/notification-templates/LEASE_END_REMINDER/reset');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.days_before, 15);
    assert.equal(res.body.data.to_recipients, null);
    assert.equal(res.body.data.subject, 'Reminder: {{sd_code}} Lease End Date on {{due_date}}');
  });

  it('follows User Rights: View to see and preview, Edit to change', async () => {
    const u = (await ctx.api('POST', '/users', { userName: 'tpl.viewer', userEmail: 'tpl.viewer@example.test', password: 'Viewpass123' })).body.data;
    const token = await ctx.login('tpl.viewer', 'Viewpass123');
    assert.equal((await ctx.api('GET', '/notification-templates', undefined, token)).status, 403);
    await ctx.api('PUT', `/user-rights/${u.user_id}`, { rights: [{ screenCode: 'NOTIFICATION', canView: true }] });
    assert.equal((await ctx.api('GET', '/notification-templates', undefined, token)).status, 200);
    assert.equal((await ctx.api('POST', '/notification-templates/LEASE_END_REMINDER/preview', lease(), token)).status, 200);
    assert.equal((await ctx.api('PUT', '/notification-templates/LEASE_END_REMINDER', lease(), token)).status, 403);
    assert.equal((await ctx.api('POST', '/notification-templates/LEASE_END_REMINDER/reset', undefined, token)).status, 403);
    assert.equal((await ctx.api('PUT', '/notification-templates/NOT_A_TYPE', lease())).status, 404);
  });
});
