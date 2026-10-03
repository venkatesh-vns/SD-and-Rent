// Shared by loading.html and error.html: fills the text from the query string
// and wires the error page buttons.
const q = new URLSearchParams(window.location.search);
const set = (id, text) => { const el = document.getElementById(id); if (el && text) el.textContent = text; };
set('message', q.get('message'));
set('detail', q.get('detail'));
const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
on('retry', () => window.sdm.retry());
on('settings', () => window.sdm.settings());
on('logs', () => window.sdm.openLogs());
