// The SD figures shown on the report and transaction screens. Each has a
// tone (colour, see --c-* in styles.css) and a one-line meaning, so the
// same figure looks the same everywhere.
export const AMOUNTS = {
  agreement: { label: 'Agreement Value', tone: 'agreement', hint: 'Total SD agreed' },
  paid: { label: 'Paid', tone: 'paid', hint: 'Deposit paid to landlord' },
  transfer: { label: 'Transfer', tone: 'out', hint: 'Moved to another SD Code' },
  adjustment: { label: 'Adjustment', tone: 'out', hint: 'Adjusted against rent / dues' },
  refund: { label: 'Refund', tone: 'out', hint: 'Returned by landlord' },
  balance: { label: 'SD Balance', tone: 'balance', hint: 'Still to pay (Agreement − Paid)' },
  repayable: { label: 'Repayable', tone: 'repayable', hint: 'Due back from landlord' },
};

// Class for an amount cell: faded when zero, bold when a balance is open
export function amountClass(kind, value) {
  const { tone } = AMOUNTS[kind];
  const classes = ['num', `tone-${tone}`];
  if (tone === 'balance' || tone === 'repayable') classes.push('tone-fill');
  if (!Number(value)) classes.push('amount-zero');
  else if (tone === 'balance' || tone === 'repayable') classes.push('amount-open');
  return classes.join(' ');
}
