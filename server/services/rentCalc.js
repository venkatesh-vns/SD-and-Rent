/**
 * Rent Schedule calculation (scope document section 6). Pure functions on
 * plain data; dates are 'YYYY-MM-DD' strings.
 *
 * Order per component and day: Rent Agreement base amount -> Rule Master
 * escalations (compounding, from each rule's effective date) -> Normal Day
 * rules for their From-To days -> Waiver Master (Status Yes sets the day to 0).
 * Amounts are worked out day by day, so a rule, waiver, start, LED or
 * Inactive End Date in the middle of a month is pro-rated on the actual
 * number of days in that month. Each month line is rounded to 2 decimals.
 */
const { BY_CODE, monthlyAmount } = require('./rentComponents');

const DAY = 86400000;
const t = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => iso(t(d) + n * DAY);
const monthStart = (d) => `${d.slice(0, 7)}-01`;
const daysInMonth = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
const monthEnd = (d) => `${d.slice(0, 7)}-${String(daysInMonth(d)).padStart(2, '0')}`;
const nextMonth = (d) => addDays(monthEnd(d), 1);
const minDate = (...ds) => ds.filter(Boolean).sort()[0] || null;
const maxDate = (...ds) => ds.filter(Boolean).sort().pop() || null;
const round2 = (x) => Math.round((x + Math.sign(x) * Number.EPSILON) * 100) / 100;

// Same day n months later; a day the target month lacks becomes its last day (31/01 + 1 -> 28/02)
function addMonths(d, n) {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7) - 1 + n;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return iso(Date.UTC(ty, tm, Math.min(+d.slice(8, 10), last)));
}

/**
 * Effective dates of the active LCD / RCD rules of one Rent Code. The first
 * rule of a type counts from the LCD / RCD; each later one (in the order the
 * rules were added) from the previous rule's escalation date.
 * Returns the rules with effective_date set (null when the base date is missing).
 */
function escalationChain(rules, { lcd, rcd }) {
  const base = { LCD: lcd || null, RCD: rcd || null };
  return rules
    .filter((r) => r.status === 'Active' && (r.rule_type === 'LCD' || r.rule_type === 'RCD'))
    .sort((a, b) => a.rule_id - b.rule_id)
    .map((r) => {
      const from = base[r.rule_type];
      if (!from) return { ...r, effective_date: null };
      const effective = addMonths(from, Number(r.escalation_months));
      base[r.rule_type] = effective;
      return { ...r, effective_date: effective };
    });
}

// A rule / waiver with no component list applies to every component
const appliesTo = (item, code) => !item.component_codes || !item.component_codes.length || item.component_codes.includes(code);

/**
 * Month lines for one Rent Code.
 *   rent        { rent_id, ll_status, inactive_end_date, lcd, rcd, led }
 *   agreements  [{ agreement_id, agreement_status, status, transfer_effective_date, components: [{ component_code, quantity, rate, percentage }] }]
 *   rules       [{ rule_id, rule_type, escalation_months, from_date, to_date, percentage, component_codes, status }]
 *   waivers     [{ from_date, to_date, waiver_status, component_codes }]
 *   transferOutDate  earliest effective date of an active Transfer that takes this
 *                    Rent Code's configuration to another landlord (its rent stops the day before)
 *   fromMonth / toMonth  'YYYY-MM-01' range of months to produce
 * Returns { lines, messages } - messages explain anything that could not be generated.
 */
function computeRentSchedule({ rent, agreements, rules = [], waivers = [], transferOutDate = null, fromMonth, toMonth }) {
  const messages = [];
  if (!rent.rcd || !rent.led) {
    messages.push(`${!rent.rcd ? 'RCD' : 'LED'} is missing on SD Master; no schedule generated.`);
    return { lines: [], messages };
  }

  const chain = escalationChain(rules, rent).filter((r) => r.effective_date);
  const normalDays = rules.filter((r) => r.status === 'Active' && r.rule_type === 'Normal Day');
  const activeWaivers = waivers.filter((w) => w.waiver_status === 'Yes');

  let end = rent.led;
  if (rent.ll_status === 'Inactive' && rent.inactive_end_date) end = minDate(end, rent.inactive_end_date);
  if (transferOutDate) end = minDate(end, addDays(transferOutDate, -1));

  const lines = [];
  for (const agreement of agreements.filter((a) => a.status === 'Active')) {
    for (const comp of agreement.components || []) {
      const def = BY_CODE[comp.component_code];
      let start = def.startsFrom === 'LCD' ? rent.lcd : rent.rcd;
      if (!start) {
        messages.push(`${def.label}: LCD is missing on SD Master, so no Maintenance Charges are generated.`);
        continue;
      }
      if (agreement.agreement_status === 'Transfer') start = maxDate(start, agreement.transfer_effective_date);
      if (start > end) continue;

      const base = monthlyAmount(comp);
      const escalations = chain.filter((r) => appliesTo(r, def.code));
      const windows = normalDays.filter((r) => appliesTo(r, def.code));
      const waived = activeWaivers.filter((w) => appliesTo(w, def.code));

      for (let m = maxDate(fromMonth, monthStart(start)); m <= minDate(toMonth, monthStart(end)); m = nextMonth(m)) {
        const from = maxDate(m, start);
        const to = minDate(monthEnd(m), end);
        const n = daysInMonth(m);
        let escalated = 0;
        let waiver = 0;
        for (let d = from; d <= to; d = addDays(d, 1)) {
          let rate = base;
          escalations.forEach((r) => { if (r.effective_date <= d) rate *= 1 + Number(r.percentage) / 100; });
          windows.forEach((r) => { if (r.from_date <= d && d <= r.to_date) rate *= 1 + Number(r.percentage) / 100; });
          const amount = rate / n;
          escalated += amount;
          if (waived.some((w) => w.from_date <= d && d <= w.to_date)) waiver += amount;
        }
        // Rule shown on the line: the latest one in force during the month
        const inForce = [
          ...escalations.filter((r) => r.effective_date <= to).map((r) => ({ date: r.effective_date, pct: r.percentage })),
          ...windows.filter((r) => r.from_date <= to && r.to_date >= from).map((r) => ({ date: r.from_date, pct: r.percentage })),
        ].sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
        const esc = round2(escalated);
        const wav = round2(waiver);
        lines.push({
          rent_id: rent.rent_id,
          agreement_id: agreement.agreement_id,
          component_code: def.code,
          rent_month: m,
          period_from: from,
          period_to: to,
          days_charged: Math.round((t(to) - t(from)) / DAY) + 1,
          base_amount: round2(base),
          rule_percentage: inForce ? Number(inForce.pct) : null,
          escalated_amount: esc,
          waiver_amount: wav,
          final_amount: round2(esc - wav),
        });
      }
    }
  }
  return { lines, messages: [...new Set(messages)] };
}

const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const pct = (p) => `${Number(p) > 0 ? '+' : ''}${Number(p)}%`;
const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

/**
 * Explains a schedule line for the reader: which escalation the month's rate
 * comes from and since when, an escalation that starts in the month, the next
 * escalation, and the waiver (rent-free) days of the month.
 *   line   { component_code, period_from, period_to }
 *   ctx    { chain: escalationChain(...) result, normalDays, waivers } of the Rent Code
 * Returns { escalation_date, escalation_rule, next_escalation_date, waiver_from,
 *           waiver_to, waiver_days, event: 'escalation' | 'waiver' | 'both' | null, remarks }
 */
// The rules and waivers of one Rent Code that apply to one component, prepared once
function prepare(ctx, code) {
  ctx.byCode = ctx.byCode || new Map();
  if (!ctx.byCode.has(code)) {
    const { chain = [], normalDays = [], waivers = [] } = ctx;
    const escalations = chain.filter((r) => r.effective_date && appliesTo(r, code))
      .map((r) => ({ date: r.effective_date, pct: r.percentage, label: `${r.rule_type} rule, every ${Number(r.escalation_months)} months` }));
    const windows = normalDays.filter((r) => r.status === 'Active' && appliesTo(r, code))
      .map((r) => ({ date: day(r.from_date), end: day(r.to_date), pct: r.percentage, label: `Normal Day rule to ${dmy(day(r.to_date))}` }));
    ctx.byCode.set(code, {
      escalations,
      windows,
      all: [...escalations, ...windows].sort((a, b) => (a.date < b.date ? -1 : 1)),
      rentFree: waivers.filter((w) => w.waiver_status === 'Yes' && appliesTo(w, code)).map((w) => ({ from: day(w.from_date), to: day(w.to_date) })),
    });
  }
  return ctx.byCode.get(code);
}

function explainLine(line, ctx) {
  const { escalations, windows, all, rentFree: waived } = prepare(ctx, line.component_code);
  const from = day(line.period_from);
  const to = day(line.period_to);
  const inForce = [...escalations.filter((e) => e.date <= to), ...windows.filter((w) => w.date <= to && w.end >= from)]
    .sort((a, b) => (a.date < b.date ? -1 : 1)).pop() || null;
  const starting = all.filter((e) => e.date >= from && e.date <= to);
  const next = all.find((e) => e.date > to) || null;

  let waiverFrom = null;
  let waiverTo = null;
  let waiverDays = 0;
  // Waivers of a component do not overlap (Waiver Master refuses it), so their days add up
  const rentFree = waived.filter((w) => w.from <= to && w.to >= from);
  rentFree.forEach((w) => { waiverDays += Math.round((t(minDate(w.to, to)) - t(maxDate(w.from, from))) / DAY) + 1; });
  if (rentFree.length) {
    waiverFrom = rentFree.map((w) => w.from).sort()[0];
    waiverTo = rentFree.map((w) => w.to).sort().pop();
  }

  const remarks = [];
  starting.forEach((e) => remarks.push(`Escalation ${pct(e.pct)} from ${dmy(e.date)} (${e.label})`));
  if (rentFree.length) remarks.push(`Rent-free ${dmy(waiverFrom)} - ${dmy(waiverTo)} (${waiverDays} day${waiverDays === 1 ? '' : 's'} this month)`);
  if (next) remarks.push(`Next escalation ${pct(next.pct)} on ${dmy(next.date)}`);
  const event = starting.length && rentFree.length ? 'both' : starting.length ? 'escalation' : rentFree.length ? 'waiver' : null;
  return {
    escalation_date: inForce ? inForce.date : null,
    escalation_rule: inForce ? `${pct(inForce.pct)} · ${inForce.label}` : null,
    next_escalation_date: next ? next.date : null,
    waiver_from: waiverFrom,
    waiver_to: waiverTo,
    waiver_days: waiverDays,
    event,
    remarks: remarks.join('; '),
  };
}

module.exports = { addMonths, addDays, monthStart, monthEnd, nextMonth, escalationChain, computeRentSchedule, explainLine, round2 };
