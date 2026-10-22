/**
 * Spreadsheet-style keyboard movement in a grid of inputs. Each input carries
 * data-row and data-col; the grid's container has data-grid. Use as onKeyDown.
 *   Up / Down     same column in the row above / below (rows without that column are skipped)
 *   Left / Right  previous / next input when the cursor is at the start / end of the
 *                 text (so you can still move inside a value); wraps to the
 *                 previous / next row
 * Tab / Shift+Tab keep their normal order (along the row, then the next row).
 */
export function gridKeyDown(e) {
  const el = e.target;
  if (!el.dataset || el.dataset.row === undefined) return;
  const grid = el.closest('[data-grid]');
  if (!grid) return;
  const cells = [...grid.querySelectorAll('input[data-row]:not(:disabled)')];
  const row = Number(el.dataset.row);
  const col = Number(el.dataset.col);
  const at = (r, c) => cells.find((x) => Number(x.dataset.row) === r && Number(x.dataset.col) === c);
  const index = cells.indexOf(el);
  const text = el.value || '';
  const caretAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
  const caretAtEnd = el.selectionStart === text.length && el.selectionEnd === text.length;

  let target = null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const rows = [...new Set(cells.map((x) => Number(x.dataset.row)))].sort((a, b) => a - b);
    const candidates = step > 0 ? rows.filter((r) => r > row) : rows.filter((r) => r < row).reverse();
    for (const r of candidates) { target = at(r, col); if (target) break; }
  } else if (e.key === 'ArrowRight' && caretAtEnd) {
    target = cells[index + 1];
  } else if (e.key === 'ArrowLeft' && caretAtStart) {
    target = cells[index - 1];
  }
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.select();
}
