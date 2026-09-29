// 'YYYY-MM-DD' (as the API returns DATE columns) -> 'DD/MM/YYYY'
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Timestamp -> 'DD/MM/YYYY HH:MM' in the viewer's time zone
export function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

// 150000.5 -> '1,50,000.50'
export function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Whole days from today to a 'YYYY-MM-DD' date (negative once it has passed)
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 864e5);
}
