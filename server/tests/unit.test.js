// Pure-function tests (no database)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDMY, formatDMY } = require('../utils/dates');
const { passwordPolicyError, isValidEmail } = require('../utils/validators');
const { cellText } = require('../utils/excel');
const { parseAmount } = require('../services/sdMasterService');
const { checkLedger, changeSummary } = require('../services/sdTransactionService');

test('parseDMY accepts valid DD/MM/YYYY and rejects the rest', () => {
  assert.equal(parseDMY('01/04/2024'), '2024-04-01');
  assert.equal(parseDMY('5/6/2025'), '2025-06-05');
  assert.equal(parseDMY('29/02/2024'), '2024-02-29');
  assert.equal(parseDMY(''), null);
  assert.equal(parseDMY('29/02/2023'), undefined);
  assert.equal(parseDMY('31/04/2024'), undefined);
  assert.equal(parseDMY('2024-04-01'), undefined);
  assert.equal(parseDMY('32/01/2024'), undefined);
  assert.equal(formatDMY('2024-04-01'), '01/04/2024');
  assert.equal(formatDMY(null), '');
});

test('password policy and email format', () => {
  assert.ok(passwordPolicyError('short1'));
  assert.ok(passwordPolicyError('lettersonly'));
  assert.ok(passwordPolicyError('12345678'));
  assert.equal(passwordPolicyError('Welcome@123'), null);
  assert.ok(isValidEmail('a.b@example.com'));
  assert.ok(!isValidEmail('not-an-email'));
});

test('parseAmount handles Indian commas, decimals and junk', () => {
  assert.equal(parseAmount('1,20,000.50'), 120000.5);
  assert.equal(parseAmount('500000'), 500000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('-5'), undefined);
  assert.equal(parseAmount('1.234'), undefined);
  assert.equal(parseAmount('abc'), undefined);
});

test('cellText turns Excel cell values into text', () => {
  assert.equal(cellText(new Date(Date.UTC(2025, 0, 15))), '15/01/2025');
  assert.equal(cellText(100000), '100000');
  assert.equal(cellText({ richText: [{ text: 'Chen' }, { text: 'nai' }] }), 'Chennai');
  assert.equal(cellText({ formula: 'A1+1', result: 42 }), '42');
  assert.equal(cellText(null), '');
});

test('checkLedger: balances by date', () => {
  const ledger = [
    { txn_id: 1, txn_date: '2024-04-01', paid_amount: 600000, transfer_amount: 0, adjustment_amount: 0, refund_amount: 0 },
    { txn_id: 2, txn_date: '2025-01-01', paid_amount: 0, transfer_amount: 0, adjustment_amount: 0, refund_amount: 100000 },
  ];
  const zero = { transfer_amount: 0, adjustment_amount: 0, refund_amount: 0 };
  // fine as stored
  assert.deepEqual(checkLedger({ agreementValue: 1000000, ledger }), []);
  // paying past the Agreement Value
  const over = checkLedger({ agreementValue: 1000000, ledger, entries: [{ txn_date: '2025-02-01', paid_amount: 400000.01, ...zero }] });
  assert.equal(over.length, 1);
  assert.match(over[0].error, /exceed Agreement Value/);
  // exactly up to the Agreement Value is allowed
  assert.deepEqual(checkLedger({ agreementValue: 1000000, ledger, entries: [{ txn_date: '2025-02-01', paid_amount: 400000, ...zero }] }), []);
  // removing the payment makes the refund go negative
  const neg = checkLedger({ agreementValue: 1000000, ledger, removeIds: new Set([1]) });
  assert.match(neg[0].error, /Repayable would be -1,00,000.00/);
  // back-dated refund before any payment
  const early = checkLedger({ agreementValue: 1000000, ledger, entries: [{ txn_date: '2024-03-01', paid_amount: 0, ...zero, refund_amount: 1 }] });
  assert.match(early[0].error, /On 01\/03\/2024/);
  // paise arithmetic stays exact
  const cents = checkLedger({
    agreementValue: 0.3,
    ledger: [],
    entries: [{ txn_date: '2024-01-01', paid_amount: 0.1, ...zero }, { txn_date: '2024-01-02', paid_amount: 0.2, ...zero }],
  });
  assert.deepEqual(cents, []);
});

test('changeSummary names changed amounts and remarks', () => {
  const before = { paid_amount: 100000, transfer_amount: 0, adjustment_amount: 0, refund_amount: 0, sd_type: 'CAM SD', fy: '2024-2025', txn_date: '2024-04-01', agreement_status: 'LOI', remarks: 'a' };
  const after = { ...before, paid_amount: 150000, remarks: 'b' };
  assert.equal(changeSummary(before, after), 'SD Paid 1,00,000.00 -> 1,50,000.00; Remarks updated');
  assert.equal(changeSummary(before, before), null);
});
