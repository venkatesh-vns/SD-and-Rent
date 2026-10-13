// The nine rent / charge components of a Rent Agreement (scope document 3.2).
// unit: 'sqft' (Sq.Ft x Rate x %), 'count' (No. x Rate x %) or 'month'
// (Rate / Month x %, no quantity). Maintenance Charges run from the LCD,
// every other component from the RCD; all end on the LED.
const COMPONENTS = [
  { code: 'ADDITIONAL_PARKING', label: 'Additional Parking Charges', short: 'Additional Parking', unit: 'count' },
  { code: 'FITOUTS', label: 'Rent - Fitouts (Exp)', short: 'Fitouts', unit: 'sqft' },
  { code: 'CAFE', label: 'Rent to Landlord - Cafe', short: 'Cafe', unit: 'sqft' },
  { code: 'CAR_PARK', label: 'Rent to Landlord - Car Park Rent', short: 'Car Park Rent', unit: 'count' },
  { code: 'OFFICE', label: 'Rent to Landlord - Office Rent', short: 'Office Rent', unit: 'sqft' },
  { code: 'SIGNAGE', label: 'Rent to Landlord - Signage Space', short: 'Signage', unit: 'month' },
  { code: 'SOLAR', label: 'Rent to Landlord - Solar', short: 'Solar', unit: 'month' },
  { code: 'TERRACE', label: 'Rent to Landlord - Terrace', short: 'Terrace', unit: 'sqft' },
  { code: 'MAINTENANCE', label: 'Maintenance Charges - Landlord', short: 'Maintenance Charges', unit: 'sqft' },
].map((c) => ({ ...c, startsFrom: c.code === 'MAINTENANCE' ? 'LCD' : 'RCD' }));

const BY_CODE = Object.fromEntries(COMPONENTS.map((c) => [c.code, c]));

// Name of the trigger field ("No.", "Sq.Ft" or "Rate / Month")
const triggerName = (c) => (c.unit === 'sqft' ? 'Sq.Ft' : c.unit === 'count' ? 'No.' : 'Rate / Month');

// Excel column headers per component, e.g. "Office Rent Sq.Ft", "Office Rent Rate", "Office Rent %"
function excelHeaders(c) {
  return c.unit === 'month'
    ? { trigger: `${c.short} Rate / Month`, percentage: `${c.short} %` }
    : { trigger: `${c.short} ${triggerName(c)}`, rate: `${c.short} Rate`, percentage: `${c.short} %` };
}

// Monthly amount: Quantity x Rate x Percentage (Signage / Solar: Rate x Percentage)
function monthlyAmount({ quantity, rate, percentage }) {
  const q = quantity === null || quantity === undefined || quantity === '' ? 1 : Number(quantity);
  return q * Number(rate) * (Number(percentage) / 100);
}

// Component code from a code or a label as typed in Excel ('Office Rent', 'OFFICE', ...)
function findComponent(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return COMPONENTS.find((c) => [c.code, c.label, c.short].some((n) => n.toLowerCase() === v)) || null;
}

module.exports = { COMPONENTS, BY_CODE, triggerName, excelHeaders, monthlyAmount, findComponent };
