// Rent Schedule calculation, checked against the scope document's examples (no database)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { monthlyAmount: rawMonthly } = require('../services/rentComponents');
const { addMonths, escalationChain, computeRentSchedule } = require('../services/rentCalc');

const rent = (o = {}) => ({ rent_id: 1, ll_status: 'Active', inactive_end_date: null, lcd: '2026-01-01', rcd: '2026-04-01', led: '2026-12-01', ...o });
const office = (quantity, rate, percentage) => ({ component_code: 'OFFICE', quantity, rate, percentage });
const agreement = (components, o = {}) => ({ agreement_id: 10, agreement_status: 'Individual', status: 'Active', components, ...o });
const byMonth = (lines) => Object.fromEntries(lines.map((l) => [l.rent_month.slice(0, 7), l.final_amount]));
const run = (args) => computeRentSchedule({ fromMonth: '2026-01-01', toMonth: '2030-12-01', ...args });

test('component monthly amounts (scope 3.2 samples)', () => {
  const monthlyAmount = (c) => Math.round(rawMonthly(c) * 100) / 100;
  assert.equal(monthlyAmount({ quantity: 2000, rate: 15, percentage: 20 }), 6000);
  assert.equal(monthlyAmount({ quantity: 2500, rate: 18, percentage: 17 }), 7650);
  assert.equal(monthlyAmount({ quantity: 10000, rate: 50, percentage: 20 }), 100000);
  assert.equal(monthlyAmount({ quantity: null, rate: 3000000, percentage: 20 }), 600000, 'Signage: Rate x %');
  assert.equal(monthlyAmount({ quantity: 40000, rate: 13, percentage: 10 }), 52000);
  assert.equal(monthlyAmount({ quantity: 104.5, rate: 10, percentage: 50 }), 522.5, 'decimal Sq.Ft');
});

test('escalation dates chain from the previous rule (scope 4.2)', () => {
  assert.equal(addMonths('2026-01-01', 36), '2029-01-01');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  const chain = escalationChain([
    { rule_id: 1, rule_type: 'RCD', escalation_months: 36, status: 'Active', percentage: 5 },
    { rule_id: 2, rule_type: 'RCD', escalation_months: 36, status: 'Active', percentage: 5 },
  ], { rcd: '2026-01-01' });
  assert.deepEqual(chain.map((r) => r.effective_date), ['2029-01-01', '2032-01-01']);
});

test('worked scenario 6.4: base, RCD escalation and October waiver', () => {
  const { lines } = run({
    rent: rent(),
    agreements: [agreement([office(1000, 10, 10)])],
    rules: [{ rule_id: 1, rule_type: 'RCD', escalation_months: 1, percentage: 15, status: 'Active' }],
    waivers: [{ from_date: '2026-10-01', to_date: '2026-10-30', waiver_status: 'Yes' }],
  });
  const m = byMonth(lines);
  assert.equal(m['2026-04'], 1000, 'starts at RCD, base amount');
  assert.equal(m['2026-05'], 1150, 'escalated from 01/05/2026');
  assert.equal(m['2026-09'], 1150);
  assert.equal(m['2026-10'], 37.1, 'waived 1-30 Oct; 31 Oct charged pro-rata (1150 / 31)');
  assert.equal(m['2026-12'], 37.1, 'ends on LED 01/12/2026 (1 day)');
  assert.equal(m['2026-03'], undefined, 'nothing before the RCD');
  const oct = lines.find((l) => l.rent_month === '2026-10-01');
  assert.equal(oct.escalated_amount, 1150);
  assert.equal(oct.waiver_amount, 1112.9);
  assert.equal(oct.rule_percentage, 15);
});

test('mid-month rule is pro-rated (scope 6.3)', () => {
  const { lines } = run({
    rent: rent({ rcd: '2026-01-01', led: '2027-12-31' }),
    agreements: [agreement([office(1000, 1, 100)])],
    rules: [{ rule_id: 1, rule_type: 'Normal Day', from_date: '2026-07-16', to_date: '2027-12-31', percentage: 15, status: 'Active' }],
  });
  assert.equal(byMonth(lines)['2026-07'], 1077.42); // 1000 x 15/31 + 1150 x 16/31
  assert.equal(byMonth(lines)['2026-08'], 1150);
});

test('percentages can be positive, zero or negative (scope 4.3)', () => {
  for (const [pct, expected] of [[75, 175000], [5, 105000], [0, 100000], [-10, 90000], [-50, 50000]]) {
    const { lines } = run({
      rent: rent({ rcd: '2026-01-01', led: '2026-03-31' }),
      agreements: [agreement([office(10000, 50, 20)])],
      rules: [{ rule_id: 1, rule_type: 'RCD', escalation_months: 1, percentage: pct, status: 'Active' }],
    });
    assert.equal(byMonth(lines)['2026-02'], expected, `${pct}%`);
  }
});

test('Inactive End Date stops rent and pro-rates the month (scope 2.3)', () => {
  const { lines } = run({
    rent: rent({ rcd: '2027-01-01', led: '2029-12-31', ll_status: 'Inactive', inactive_end_date: '2027-08-15' }),
    agreements: [agreement([office(3100, 1, 100)])],
  });
  const m = byMonth(lines);
  assert.equal(m['2027-08'], 1500); // 3100 x 15/31
  assert.equal(m['2027-09'], undefined);
});

test('waiver Jan-Mar 2027 sets those months to zero (scope 5.2)', () => {
  const { lines } = run({
    rent: rent({ rcd: '2026-01-01', led: '2027-12-31' }),
    agreements: [agreement([office(10000, 50, 20)])],
    waivers: [
      { from_date: '2027-01-01', to_date: '2027-03-31', waiver_status: 'Yes' },
      { from_date: '2027-05-01', to_date: '2027-05-31', waiver_status: 'No' },
    ],
  });
  const m = byMonth(lines);
  assert.deepEqual([m['2026-12'], m['2027-01'], m['2027-02'], m['2027-03'], m['2027-04'], m['2027-05']], [100000, 0, 0, 0, 100000, 100000]);
});

test('Maintenance runs from the LCD; no LCD means no Maintenance (scope 3.3)', () => {
  const maint = { component_code: 'MAINTENANCE', quantity: 40000, rate: 13, percentage: 10 };
  const withLcd = run({ rent: rent(), agreements: [agreement([maint, office(1000, 10, 10)])] });
  assert.equal(withLcd.lines.filter((l) => l.component_code === 'MAINTENANCE')[0].rent_month, '2026-01-01');
  assert.equal(withLcd.lines.filter((l) => l.component_code === 'OFFICE')[0].rent_month, '2026-04-01');
  const noLcd = run({ rent: rent({ lcd: null }), agreements: [agreement([maint, office(1000, 10, 10)])] });
  assert.equal(noLcd.lines.filter((l) => l.component_code === 'MAINTENANCE').length, 0);
  assert.match(noLcd.messages[0], /LCD is missing/);
});

test('missing RCD or LED stops generation (scope 6.6)', () => {
  const res = run({ rent: rent({ led: null }), agreements: [agreement([office(1, 1, 100)])] });
  assert.equal(res.lines.length, 0);
  assert.match(res.messages[0], /LED is missing/);
});

test('rules can target one component; transfer splits rent between Rent Codes', () => {
  const comps = [office(1000, 1, 100), { component_code: 'SOLAR', quantity: null, rate: 500, percentage: 100 }];
  const { lines } = run({
    rent: rent({ rcd: '2026-01-01', led: '2026-12-31' }),
    agreements: [agreement(comps)],
    rules: [{ rule_id: 1, rule_type: 'RCD', escalation_months: 1, percentage: 10, status: 'Active', component_codes: ['SOLAR'] }],
    transferOutDate: '2026-07-01',
  });
  const office2 = lines.filter((l) => l.component_code === 'OFFICE');
  const solar = lines.filter((l) => l.component_code === 'SOLAR');
  assert.equal(office2.find((l) => l.rent_month === '2026-03-01').final_amount, 1000, 'rule not applied to Office');
  assert.equal(solar.find((l) => l.rent_month === '2026-03-01').final_amount, 550);
  assert.equal(office2[office2.length - 1].rent_month, '2026-06-01', 'source stops the day before the transfer');

  const target = run({
    rent: rent({ rent_id: 2, rcd: '2026-01-01', led: '2026-12-31' }),
    agreements: [agreement([office(1000, 1, 100)], { agreement_status: 'Transfer', transfer_effective_date: '2026-07-01' })],
  });
  assert.equal(target.lines[0].rent_month, '2026-07-01', 'transfer starts on its effective date');
});

test('rules and waivers can apply to several components', () => {
  const comps = [office(1000, 1, 100), { component_code: 'CAFE', quantity: 100, rate: 1, percentage: 100 }, { component_code: 'SOLAR', quantity: null, rate: 500, percentage: 100 }];
  const { lines } = run({
    rent: rent({ rcd: '2026-01-01', led: '2026-12-31' }),
    agreements: [agreement(comps)],
    rules: [{ rule_id: 1, rule_type: 'RCD', escalation_months: 1, percentage: 10, status: 'Active', component_codes: ['OFFICE', 'CAFE'] }],
    waivers: [{ from_date: '2026-03-01', to_date: '2026-03-31', waiver_status: 'Yes', component_codes: ['CAFE', 'SOLAR'] }],
  });
  const at = (code, m) => lines.find((l) => l.component_code === code && l.rent_month === m).final_amount;
  assert.deepEqual([at('OFFICE', '2026-02-01'), at('CAFE', '2026-02-01'), at('SOLAR', '2026-02-01')], [1100, 110, 500], 'rule on Office + Cafe only');
  assert.deepEqual([at('OFFICE', '2026-03-01'), at('CAFE', '2026-03-01'), at('SOLAR', '2026-03-01')], [1100, 0, 0], 'waiver on Cafe + Solar only');
});
