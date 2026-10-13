// Shared bits of the Rent Transaction controllers
const { parseDMY } = require('../utils/dates');

function paging(query) {
  return {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    pageSize: Math.min(Math.max(parseInt(query.pageSize, 10) || 50, 1), 500),
  };
}

function badRequest(res, errors) {
  return res.status(400).json({ success: false, message: errors.map((e) => e.error).join(' '), errors });
}

// DD/MM/YYYY query dates -> 'YYYY-MM-DD' (invalid = ignored)
function withDates(query, keys) {
  const out = { ...query };
  keys.forEach((k) => { out[k] = parseDMY(query[k]) || null; });
  return out;
}

// Excel cell -> trimmed text ('' for blank)
const cell = (row, header) => (row[header] === undefined || row[header] === null ? '' : String(row[header]).trim());

module.exports = { paging, badRequest, withDates, cell };
