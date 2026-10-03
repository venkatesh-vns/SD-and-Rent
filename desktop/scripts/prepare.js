/**
 * Gathers everything the installer ships into desktop/staging:
 *   staging/backend/server              API (production packages only)
 *   staging/backend/database/migrations SQL migrations
 *   staging/backend/client/build        built React screens
 *   staging/pgsql                       PostgreSQL server binaries (bin, lib, share)
 *
 * PostgreSQL is copied from a local install: set PG_HOME, or it defaults to
 * C:\Program Files\PostgreSQL\18. Run from /desktop:  node scripts/prepare.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const STAGING = path.resolve(__dirname, '..', 'staging');
const PG_HOME = process.env.PG_HOME || 'C:\\Program Files\\PostgreSQL\\18';

const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const step = (msg) => console.log(`\n=== ${msg}`);

function copyDir(from, to, filter = () => true) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => filter(src, fs.statSync(src).isDirectory()) });
}

step('Cleaning staging');
fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });

// ---------- Server ----------
step('Copying server');
const serverOut = path.join(STAGING, 'backend', 'server');
const SKIP_SERVER = new Set(['node_modules', 'tests', '.env', 'uploads']);
copyDir(path.join(ROOT, 'server'), serverOut, (src) => {
  const rel = path.relative(path.join(ROOT, 'server'), src);
  const top = rel.split(path.sep)[0];
  return !SKIP_SERVER.has(top) && !src.endsWith('.log');
});
fs.mkdirSync(path.join(serverOut, 'uploads'), { recursive: true });
step('Installing server production packages');
run('npm install --omit=dev --no-audit --no-fund', serverOut);

step('Copying database migrations');
copyDir(path.join(ROOT, 'database', 'migrations'), path.join(STAGING, 'backend', 'database', 'migrations'));

// ---------- Client ----------
step('Building client');
// No inline runtime script: the server's Content-Security-Policy allows scripts from 'self' only
run('npm run build', path.join(ROOT, 'client'), { INLINE_RUNTIME_CHUNK: 'false', GENERATE_SOURCEMAP: 'false', CI: 'true', REACT_APP_API_URL: '' });
copyDir(path.join(ROOT, 'client', 'build'), path.join(STAGING, 'backend', 'client', 'build'));

// ---------- PostgreSQL ----------
step(`Copying PostgreSQL from ${PG_HOME}`);
if (!fs.existsSync(path.join(PG_HOME, 'bin', 'postgres.exe'))) {
  throw new Error(`PostgreSQL not found at ${PG_HOME}. Set PG_HOME to a PostgreSQL install folder.`);
}
const pgOut = path.join(STAGING, 'pgsql');
const KEEP_EXE = new Set(['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_dump.exe', 'pg_restore.exe', 'psql.exe', 'pg_isready.exe']);
copyDir(path.join(PG_HOME, 'bin'), path.join(pgOut, 'bin'), (src, isDir) => {
  if (isDir) return path.basename(src) === 'bin';
  const name = path.basename(src).toLowerCase();
  return KEEP_EXE.has(name) || name.endsWith('.dll');
});
copyDir(path.join(PG_HOME, 'lib'), path.join(pgOut, 'lib'), (src, isDir) => isDir ? path.basename(src) === 'lib' : src.toLowerCase().endsWith('.dll'));
copyDir(path.join(PG_HOME, 'share'), path.join(pgOut, 'share'));
for (const f of ['server_license.txt', 'commandlinetools_3rd_party_licenses.txt']) {
  if (fs.existsSync(path.join(PG_HOME, f))) fs.copyFileSync(path.join(PG_HOME, f), path.join(pgOut, f));
}

// Visual C++ runtime next to the PostgreSQL programs (app-local), so a fresh
// PC does not need the VC++ Redistributable installed separately
const SYS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll']) {
  const src = path.join(SYS, dll);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(pgOut, 'bin', dll));
}

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
step(`Done: backend ${(size(path.join(STAGING, 'backend')) / 1e6).toFixed(0)} MB, pgsql ${(size(pgOut) / 1e6).toFixed(0)} MB`);
