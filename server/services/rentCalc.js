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

const appliesTo = (item, code) => !item.component_code || item.component_code === code;

/**
 * Month lines for one Rent Code.
 *   rent        { rent_id, ll_status, inactive_end_date, lcd, rcd, led }
 *   agreements  [{ agreement_id, agreement_status, status, transfer_effective_date, components: [{ component_code, quantity, rate, percentage }] }]
 *   rules       [{ rule_id, rule_type, escalation_months, from_date, to_date, percentage, component_code, status }]
 *   waivers     [{ from_date, to_date, waiver_status, component_code }]
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

module.exports = { addMonths, addDays, monthStart, monthEnd, nextMonth, escalationChain, computeRentSchedule, round2 };
