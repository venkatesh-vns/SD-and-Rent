// Multi-select filters arrive as a comma-separated string ("a,b") or a
// repeated query parameter (?x=a&x=b). Both turn into a list of values;
// an empty list means "no filter".
function listOf(value) {
  if (value === undefined || value === null || value === '') return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(parts.map((v) => String(v).trim()).filter(Boolean))];
}

// Same, keeping only whole-number ids (anything else is ignored)
function idsOf(value) {
  return listOf(value).filter((v) => /^\d+$/.test(v)).map(Number);
}

module.exports = { listOf, idsOf };
