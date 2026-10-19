// The rent / charge components of a Rent Agreement (scope document 3.2, plus
// Rent Other Charges, which works like Solar).
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
  { code: 'OTHER_CHARGES', label: 'Rent Other Charges', short: 'Other Charges', unit: 'month', section: 'Rent Other Charges' },
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

// Monthly amount: Quantity x Rate x Percentage (Signage / Solar / Other Charges: Rate x Percentage)
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

// Rule / Waiver "Applies to": one Yes/No column per component in Excel templates
const appliesToHeader = (c) => `Applies to: ${c.short}`;
const APPLIES_TO_COLUMNS = COMPONENTS.map((c) => ({ header: appliesToHeader(c), required: false }));

/**
 * "Applies to" components from the screen (array or comma-separated codes / names).
 * Returns { codes: [...] | null (= all components), unknown: [values not recognised] }.
 */
function parseComponentList(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  const codes = [];
  const unknown = [];
  parts.map((p) => String(p).trim()).filter(Boolean).forEach((p) => {
    const c = findComponent(p);
    if (!c) unknown.push(p);
    else if (!codes.includes(c.code)) codes.push(c.code);
  });
  return { codes: codes.length ? COMPONENTS.map((c) => c.code).filter((k) => codes.includes(k)) : null, unknown };
}

/**
 * "Applies to" from an Excel row's Yes/No columns. Yes = selected, No / blank = not.
 * Returns { given: false } when every column is blank (caller keeps the stored value
 * or uses all components), else { given: true, codes, errors }.
 */
function componentsFromRow(row) {
  const errors = [];
  const codes = [];
  let given = false;
  COMPONENTS.forEach((c) => {
    const header = appliesToHeader(c);
    const raw = row[header] === undefined || row[header] === null ? '' : String(row[header]).trim();
    if (!raw) return;
    given = true;
    const v = raw.toLowerCase();
    if (v === 'yes' || v === 'y') codes.push(c.code);
    else if (v !== 'no' && v !== 'n') errors.push({ field: header, value: raw, error: `${header} must be Yes or No.` });
  });
  if (given && !codes.length && !errors.length) {
    errors.push({ field: 'Applies to', value: 'No', error: 'Select at least one component (Yes), or leave every Applies to column blank for all components.' });
  }
  return { given, codes, errors };
}

// Selected = Yes, else No (for exports); "All components" when the list is empty
const appliesToValues = (codes) => COMPONENTS.map((c) => (!codes || !codes.length || codes.includes(c.code) ? 'Yes' : 'No'));
const appliesToLabel = (codes) => (!codes || !codes.length ? 'All components' : codes.map((k) => BY_CODE[k]?.label || k).join(', '));

module.exports = {
  COMPONENTS, BY_CODE, triggerName, excelHeaders, monthlyAmount, findComponent,
  APPLIES_TO_COLUMNS, parseComponentList, componentsFromRow, appliesToValues, appliesToLabel,
};
