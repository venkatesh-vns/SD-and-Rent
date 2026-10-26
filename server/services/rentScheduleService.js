/**
 * Generates and stores Rent Schedules (scope document section 6).
 *  - generate(): the Rent Schedule screen's Generate / Regenerate for a month range
 *  - regenerateFuture(): after any Rent Master / Agreement / Rule / Waiver change,
 *    re-calculates the months already generated from the current month onward
 * Both record a rent_schedule_runs row and an audit entry.
 */
const { pool } = require('../config/db');
const rentMasterModel = require('../models/rentMasterModel');
const agreementModel = require('../models/rentAgreementModel');
const ruleModel = require('../models/rentRuleModel');
const waiverModel = require('../models/rentWaiverModel');
const scheduleModel = require('../models/rentScheduleModel');
const { computeRentSchedule, monthStart, escalationChain, explainLine } = require('./rentCalc');
const { logAudit } = require('../utils/audit');
const { listOf } = require('../utils/filters');

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

/**
 * Adds to schedule lines (as read for the screen / export) the escalation date of
 * the month's rate, the escalation starting in the month, the next escalation and
 * the waiver period - worked out from the Rent Code's rules and waivers, which
 * cannot change for months already generated. Lines need rent_id, lcd and rcd.
 */
async function explainLines(rows, db = pool) {
  const rentIds = [...new Set(rows.map((r) => r.rent_id))];
  const ctx = new Map();
  for (let i = 0; i < rentIds.length; i += 1000) {
    const ids = rentIds.slice(i, i + 1000);
    const [rules, waivers] = await Promise.all([ruleModel.forRents(ids, db), waiverModel.forRents(ids, db)]);
    ids.forEach((id) => ctx.set(id, { rules: [], waivers: [] }));
    rules.forEach((r) => ctx.get(r.rent_id).rules.push(r));
    waivers.forEach((w) => ctx.get(w.rent_id).waivers.push(w));
  }
  const chains = new Map();
  for (const [i, line] of rows.entries()) {
    const c = ctx.get(line.rent_id);
    if (!chains.has(line.rent_id)) {
      chains.set(line.rent_id, {
        chain: escalationChain(c.rules, { lcd: line.lcd, rcd: line.rcd }),
        normalDays: c.rules.filter((r) => r.rule_type === 'Normal Day'),
        waivers: c.waivers,
      });
    }
    Object.assign(line, explainLine(line, chains.get(line.rent_id)));
    if (i % 2000 === 1999) await new Promise((resolve) => setImmediate(resolve));
  }
  return rows;
}

// Everything the calculation needs for a set of Rent Codes
async function loadInputs(rentIds, db) {
  const rents = (await db.query(`${rentMasterModel.SELECT} WHERE r.rent_id = ANY($1::int[])`, [rentIds])).rows;
  const agreements = await agreementModel.forRents(rentIds, db);
  const rules = await ruleModel.forRents(rentIds, db);
  const waivers = await waiverModel.forRents(rentIds, db);
  // Active Transfers that take a Rent Code's configuration to another landlord
  const outs = (await db.query(
    `SELECT transfer_from_rent_id AS rent_id, MIN(transfer_effective_date) AS effective
     FROM rent_agreements WHERE status = 'Active' AND agreement_status = 'Transfer' AND transfer_from_rent_id = ANY($1::int[])
     GROUP BY transfer_from_rent_id`, [rentIds]
  )).rows;
  const group = (list) => list.reduce((m, x) => ((m[x.rent_id] = m[x.rent_id] || []).push(x), m), {});
  return {
    rents,
    agreements: group(agreements),
    rules: group(rules),
    waivers: group(waivers),
    transferOut: Object.fromEntries(outs.map((o) => [o.rent_id, o.effective])),
  };
}

/**
 * Calculates and stores the schedule of the given Rent Codes for fromMonth..toMonth.
 * agreementStatus: optional list limiting which agreements are generated.
 * Returns { run, lines, messages: [{ rentCode, message }] }.
 */
// Rent Codes calculated and saved per batch: memory stays flat however many
// Rent Codes and years are generated (all batches are in the caller's transaction)
const BATCH = 200;

async function generateFor(rentIds, { fromMonth, toMonth, agreementStatus = [], trigger, filters, by, action = 'GENERATE' }, db) {
  const run = await scheduleModel.createRun({ trigger, fromMonth, toMonth, filters, rentCodes: 0, lines: 0, messages: [], by }, db);
  const messages = [];
  const linedRents = new Set();
  let lineCount = 0;

  for (let b = 0; b < rentIds.length; b += BATCH) {
    const inputs = await loadInputs(rentIds.slice(b, b + BATCH), db);
    const lines = [];
    const doneRents = [];
    const agreementIds = [];
    for (const [i, rent] of inputs.rents.entries()) {
      // Let other requests on this web worker run between parts of the calculation
      if (i % 25 === 24) await new Promise((resolve) => setImmediate(resolve));
      const agreements = (inputs.agreements[rent.rent_id] || [])
        .filter((a) => !agreementStatus.length || agreementStatus.includes(a.agreement_status));
      const active = agreements.filter((a) => a.status === 'Active');
      if (!active.length) {
        if (action === 'GENERATE') messages.push({ rentCode: rent.rent_code, message: 'No active Rent Agreement.' });
        // Still cleared below, so future months of agreements made Inactive are removed
        if (agreements.length) doneRents.push(rent.rent_id);
        continue;
      }
      const { lines: rentLines, messages: notes } = computeRentSchedule({
        rent,
        agreements: active,
        rules: inputs.rules[rent.rent_id] || [],
        waivers: inputs.waivers[rent.rent_id] || [],
        transferOutDate: inputs.transferOut[rent.rent_id] || null,
        fromMonth,
        toMonth,
      });
      notes.forEach((message) => messages.push({ rentCode: rent.rent_code, message }));
      if (!rentLines.length && notes.some((n) => /no schedule generated/.test(n))) continue;
      for (const l of rentLines) lines.push(l);
      if (rentLines.length) linedRents.add(rent.rent_id);
      doneRents.push(rent.rent_id);
      agreementIds.push(...active.map((a) => a.agreement_id));
    }
    if (doneRents.length) {
      await scheduleModel.replaceLines({
        rentIds: doneRents, agreementIds, fromMonth, toMonth, keepPastBefore: monthStart(today()), lines, runId: run.run_id, by,
      }, db);
      await scheduleModel.markGenerated(doneRents, toMonth, db);
    }
    lineCount += lines.length;
  }

  const rentCodes = linedRents.size;
  await scheduleModel.finishRun(run.run_id, { rentCodes, lines: lineCount, messages }, db);
  await logAudit({
    tableName: 'rent_schedule_runs', recordId: run.run_id, action, actionBy: by,
    details: `${trigger}: ${rentCodes} Rent Code(s), ${lineCount} line(s), ${fromMonth.slice(0, 7)} to ${toMonth.slice(0, 7)}`
      + (messages.length ? `; ${messages.length} message(s)` : ''),
  }, db);
  return { run: { ...run, rent_codes: rentCodes, lines: lineCount }, lines: lineCount, rentCodes, messages };
}

// Rent Schedule screen: Generate (or Regenerate) for a date range and filters
async function generate({ fromDate, toDate, filters = {}, by }) {
  const fromMonth = monthStart(fromDate);
  const toMonth = monthStart(toDate);
  const rentIds = await rentMasterModel.findIds(filters);
  return withClient((db) => generateFor(rentIds, {
    fromMonth, toMonth, agreementStatus: listOf(filters.agreementStatus), trigger: 'Generate', filters, by,
  }, db));
}

/**
 * Re-calculates already generated months, from the current month onward, of
 * the given Rent Codes (after a change). Nothing happens for a Rent Code with
 * no future schedule yet. Runs on the caller's transaction client.
 */
async function regenerateFuture(rentIds, { by, trigger }, db) {
  const ids = [...new Set(rentIds.filter(Boolean).map(Number))];
  const last = await scheduleModel.lastMonths(ids, db);
  const fromMonth = monthStart(today());
  const due = ids.filter((id) => last[id] && last[id] >= fromMonth);
  if (!due.length) return null;
  const toMonth = due.map((id) => last[id]).sort().pop();
  return generateFor(due, { fromMonth, toMonth, trigger: `Auto: ${trigger}`, by, action: 'REGENERATE' }, db);
}

// After an SD Master change to LCD, RCD or LED: regenerate its Rent Codes
async function regenerateForSd(before, after, { by }, db) {
  const keys = ['lease_commencement_date', 'rent_commencement_date', 'lease_end_date'];
  if (!before || keys.every((k) => (before[k] || null) === (after[k] || null))) return null;
  const ids = (await db.query('SELECT rent_id FROM rent_master WHERE sd_id = $1', [after.sd_id])).rows.map((r) => r.rent_id);
  return ids.length ? regenerateFuture(ids, { by, trigger: `SD Master dates changed (${after.sd_code})` }, db) : null;
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { explainLines, generate, regenerateFuture, regenerateForSd, loadInputs };
