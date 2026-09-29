// Predefined date ranges for date filters. Dates are local calendar days;
// filters carry them as 'DD/MM/YYYY' strings (what the API accepts).
// Weeks run Monday-Sunday; the financial year runs April-March, so its
// quarters (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) match calendar quarters.

const day = (y, m, d) => new Date(y, m, d);
const addDays = (date, n) => day(date.getFullYear(), date.getMonth(), date.getDate() + n);

export function toDMY(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

// 'DD/MM/YYYY' <-> 'YYYY-MM-DD' (the value of <input type="date">)
export function dmyToIso(dmy) {
  const m = String(dmy || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
export function isoToDmy(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const weekStart = (t) => addDays(t, -((t.getDay() + 6) % 7)); // Monday
const quarterStart = (t) => day(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1);
const fyStartYear = (t) => (t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1);

// [key, label, (today) => [from, to]]
export const DATE_PRESETS = [
  ['today', 'Today', (t) => [t, t]],
  ['yesterday', 'Yesterday', (t) => [addDays(t, -1), addDays(t, -1)]],
  ['thisWeek', 'This Week', (t) => [weekStart(t), addDays(weekStart(t), 6)]],
  ['lastWeek', 'Last Week', (t) => [addDays(weekStart(t), -7), addDays(weekStart(t), -1)]],
  ['thisMonth', 'This Month', (t) => [day(t.getFullYear(), t.getMonth(), 1), day(t.getFullYear(), t.getMonth() + 1, 0)]],
  ['lastMonth', 'Last Month', (t) => [day(t.getFullYear(), t.getMonth() - 1, 1), day(t.getFullYear(), t.getMonth(), 0)]],
  ['thisQuarter', 'This Quarter', (t) => { const s = quarterStart(t); return [s, day(s.getFullYear(), s.getMonth() + 3, 0)]; }],
  ['lastQuarter', 'Last Quarter', (t) => { const s = quarterStart(t); return [day(s.getFullYear(), s.getMonth() - 3, 1), addDays(s, -1)]; }],
  ['thisFy', 'This Financial Year', (t) => { const y = fyStartYear(t); return [day(y, 3, 1), day(y + 1, 2, 31)]; }],
  ['lastFy', 'Last Financial Year', (t) => { const y = fyStartYear(t) - 1; return [day(y, 3, 1), day(y + 1, 2, 31)]; }],
  ['ytd', 'Year to Date (YTD)', (t) => [day(fyStartYear(t), 3, 1), t]],
];

function today() {
  const n = new Date();
  return day(n.getFullYear(), n.getMonth(), n.getDate());
}

// { from, to } in 'DD/MM/YYYY' for a preset key
export function presetRange(key, now = today()) {
  const preset = DATE_PRESETS.find(([k]) => k === key);
  if (!preset) return { from: '', to: '' };
  const [from, to] = preset[2](now);
  return { from: toDMY(from), to: toDMY(to) };
}

// The preset whose range is exactly from-to (so a chosen preset keeps its name), or null
export function matchPreset(from, to, now = today()) {
  if (!from || !to) return null;
  const hit = DATE_PRESETS.find(([key]) => {
    const r = presetRange(key, now);
    return r.from === from && r.to === to;
  });
  return hit ? { key: hit[0], label: hit[1] } : null;
}
