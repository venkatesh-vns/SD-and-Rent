// Desktop app settings, kept in the user's AppData folder (config.json):
//   { mode: 'server' | 'client',
//     server: { httpPort, pgPort, dbPassword, jwtSecret, settingsSecret },
//     client: { url } }
const fs = require('fs');
const path = require('path');

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function save(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// 'pc-name', '192.168.1.20', '192.168.1.20:5050' or a full URL -> 'http://host:port'
function normalizeServerUrl(input, defaultPort) {
  let text = String(input || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    if (!url.port) url.port = String(defaultPort);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

module.exports = { load, save, normalizeServerUrl };
