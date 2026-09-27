// Dates are entered and shown as DD/MM/YYYY and stored as DATE.
// PostgreSQL DATE values come back as 'YYYY-MM-DD' strings (see config/db.js).

const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/**
 * Parses 'DD/MM/YYYY' (also D/M/YYYY, '-' or '.' separators).
 * Returns 'YYYY-MM-DD', null for a blank value, or undefined when invalid.
 */
function parseDMY(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(DMY_RE);
  if (!match) return undefined;
  const [, d, m, y] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  if (y < 1900 || y > 2200) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' ('' for null)
function formatDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

module.exports = { parseDMY, formatDMY };
