// SD Maintenance desktop app (Electron).
// First launch asks how this PC is used:
//  - "This PC holds the data": runs a private PostgreSQL and the SD Maintenance
//    server here; other PCs connect to http://<this-pc>:<port>.
//  - "Connect to the main PC": opens the screens served by that PC.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const configStore = require('./lib/config');
const { Database, freePort, DB_USER, DB_NAME } = require('./lib/database');
const { startBackend, lanAddresses } = require('./lib/backend');
const channel = require('./lib/channel');

const DEFAULT_HTTP_PORT = channel.HTTP_PORT;
const DEFAULT_PG_PORT = channel.PG_PORT;
const APP_NAME = channel.APP_NAME;

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'staging');
// SDM_USER_DATA: run with a separate data folder (testing a build without touching real data)
if (process.env.SDM_USER_DATA) app.setPath('userData', process.env.SDM_USER_DATA);
const USER_DIR = app.getPath('userData'); // %APPDATA%\SD Maintenance
const CONFIG_FILE = path.join(USER_DIR, 'config.json');
const LOG_DIR = path.join(USER_DIR, 'logs');

let config = configStore.load(CONFIG_FILE);
let mainWindow = null;
let backend = null;
let database = null;
let quitting = false;

// ---------- logging (AppData\SD Maintenance\logs\app.log) ----------
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(path.join(LOG_DIR, 'app.log'), { flags: 'a' });
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  logStream.write(`${line}\n`);
  if (!app.isPackaged) process.stdout.write(`${line}\n`);
}
for (const level of ['log', 'info', 'warn', 'error']) console[level] = (...a) => log(...a);

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- windows ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, 'ui', 'icon.png'),
    backgroundColor: '#f4f6f5',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Links that open new windows go to the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', (e) => {
    if (quitting || config.mode !== 'server' || !backend) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: [`Close ${APP_NAME}`, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: `Close ${APP_NAME}`,
      message: `This PC holds the ${APP_NAME} data.`,
      detail: 'Other PCs connected to this one cannot use the application until you open it again.',
    });
    if (choice === 1) e.preventDefault();
  });
}

function showPage(name, query = {}) {
  mainWindow.loadFile(path.join(__dirname, 'ui', name), { query });
}

function showError(message, detail) {
  showPage('error.html', { message, detail: detail || '', mode: config.mode || '' });
}

// ---------- start-up ----------
async function startServerMode(firstAdmin) {
  const s = config.server;
  database = new Database({ pgHome: path.join(RES, 'pgsql'), dataDir: path.join(USER_DIR, 'pgdata'), logDir: LOG_DIR, log });
  if (!database.initialized) await database.init({ password: s.dbPassword, port: s.pgPort });
  await database.start();
  const { Client } = require(path.join(RES, 'backend', 'server', 'node_modules', 'pg'));
  await database.ensureDatabase({ Client, password: s.dbPassword, port: s.pgPort });
  backend = await startBackend({
    backendDir: path.join(RES, 'backend'),
    uploadDir: path.join(USER_DIR, 'uploads'),
    backupDir: path.join(USER_DIR, 'backups'), // nightly database backups
    pgBin: path.join(RES, 'pgsql', 'bin'),
    logDir: path.join(LOG_DIR, 'server'),
    httpPort: s.httpPort,
    pgPort: s.pgPort,
    dbUser: DB_USER,
    dbName: DB_NAME,
    dbPassword: s.dbPassword,
    jwtSecret: s.jwtSecret,
    settingsSecret: s.settingsSecret,
    emailDryRun: channel.EMAIL_DRY_RUN,
    firstAdmin,
    log,
  });
  mainWindow.loadURL(`http://localhost:${s.httpPort}/login`);
}

async function startClientMode() {
  const url = config.client?.url;
  if (!(await reachable(url))) {
    showError(`Cannot reach the ${APP_NAME} server at ${url}.`, `Check that the main PC is switched on, the ${APP_NAME} app is open on it, and this PC is on the same network.`);
    return;
  }
  mainWindow.loadURL(`${url}/login`);
}

async function reachable(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function boot() {
  buildMenu();
  try {
    if (config.mode === 'server') {
      showPage('loading.html', { message: 'Starting the database...' });
      await startServerMode(null);
    } else if (config.mode === 'client') {
      showPage('loading.html', { message: 'Connecting to the main PC...' });
      await startClientMode();
    } else {
      showPage('setup.html');
    }
  } catch (err) {
    log('Start-up failed', err);
    showError(`${APP_NAME} could not start.`, err.message);
  }
}

// ---------- menu ----------
function buildMenu() {
  const server = config.mode === 'server';
  const template = [
    {
      label: 'File',
      submenu: [
        ...(server ? [{ label: 'Back up database...', click: backupDatabase }, { type: 'separator' }] : []),
        { label: 'Open data and log folder', click: () => shell.openPath(USER_DIR) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(process.env.SDM_DEVTOOLS ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Settings',
      submenu: [
        ...(server ? [{ label: 'Address for other PCs...', click: showAddresses }] : []),
        { label: 'Connection settings...', click: changeConnection },
      ],
    },
    {
      label: 'Help',
      submenu: [{
        label: `About ${APP_NAME}`,
        click: () => dialog.showMessageBox(mainWindow, {
          type: 'info', title: 'About', message: `${APP_NAME} ${app.getVersion()}`,
          detail: `IndiQube Security Deposit and Lease Management\n\nMode: ${server ? 'This PC holds the data' : config.mode === 'client' ? `Connected to ${config.client.url}` : 'Not set up'}\nData and logs: ${USER_DIR}`,
        }),
      }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAddresses() {
  const port = config.server.httpPort;
  const list = lanAddresses().map((ip) => `http://${ip}:${port}`);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Address for other PCs',
    message: `On the other PCs, install ${APP_NAME}, choose "Connect to the main PC" and enter:`,
    detail: `${list.length ? list.join('\n') : `http://<this PC's name>:${port}`}\n\nThey can also open this address in a web browser.\nThis PC must be on, with ${APP_NAME} open.`,
  });
}

async function changeConnection() {
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Change settings', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Connection settings',
    message: `Change how this PC connects to ${APP_NAME}?`,
    detail: config.mode === 'server'
      ? 'The data on this PC is kept. Choosing "This PC holds the data" again later reopens it.'
      : 'The app will restart with the setup screen.',
  });
  if (choice !== 0) return;
  await shutdown();
  config = { ...config, mode: undefined };
  configStore.save(CONFIG_FILE, config);
  buildMenu();
  showPage('setup.html');
}

async function backupDatabase() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: `Back up ${APP_NAME} database`,
    defaultPath: path.join(app.getPath('documents'), `${APP_NAME.replace(/[^A-Za-z0-9]+/g, '_')}_backup_${stamp}.dump`),
    filters: [{ name: 'PostgreSQL backup', extensions: ['dump'] }],
  });
  if (canceled || !filePath) return;
  try {
    await database.backup({ file: filePath, password: config.server.dbPassword, port: config.server.pgPort });
    dialog.showMessageBox(mainWindow, { type: 'info', title: 'Backup complete', message: 'The database was backed up.', detail: filePath });
  } catch (err) {
    log('Backup failed', err);
    dialog.showErrorBox('Backup failed', err.message);
  }
}

// ---------- setup screen (IPC from local pages only) ----------
const fromLocalPage = (event) => String(event.senderFrame?.url || '').startsWith('file://');

ipcMain.handle('sdm:info', (event) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  return {
    version: app.getVersion(),
    hasLocalData: fs.existsSync(path.join(USER_DIR, 'pgdata', 'PG_VERSION')),
    clientUrl: config.client?.url || '',
    defaultPort: DEFAULT_HTTP_PORT,
    appName: APP_NAME,
    uat: channel.UAT,
    mode: config.mode || '',
  };
});

ipcMain.handle('sdm:test-server', async (event, input) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  const url = configStore.normalizeServerUrl(input, DEFAULT_HTTP_PORT);
  if (!url) return { ok: false, message: 'Enter the main PC address, for example 192.168.1.20' };
  return (await reachable(url)) ? { ok: true, url } : { ok: false, url, message: `No ${APP_NAME} server answered at ${url}.` };
});

ipcMain.handle('sdm:setup-client', async (event, input) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  const url = configStore.normalizeServerUrl(input, DEFAULT_HTTP_PORT);
  if (!url) return { ok: false, message: 'Enter the main PC address, for example 192.168.1.20' };
  if (!(await reachable(url))) return { ok: false, message: `No ${APP_NAME} server answered at ${url}. Check the address and that the app is open on the main PC.` };
  config = { ...config, mode: 'client', client: { url } };
  configStore.save(CONFIG_FILE, config);
  buildMenu();
  mainWindow.loadURL(`${url}/login`);
  return { ok: true };
});

ipcMain.handle('sdm:setup-server', async (event, admin) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  const hasData = fs.existsSync(path.join(USER_DIR, 'pgdata', 'PG_VERSION'));
  let firstAdmin = null;
  if (!hasData) {
    const email = String(admin?.email || '').trim();
    const password = String(admin?.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Enter a valid administrator email address.' };
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return { ok: false, message: 'The password needs at least 8 characters, with a letter and a number.' };
    }
    firstAdmin = { email, password };
  }
  const secret = () => crypto.randomBytes(32).toString('hex');
  const existing = config.server || {};
  config = {
    ...config,
    mode: 'server',
    server: {
      httpPort: existing.httpPort || await freePort(DEFAULT_HTTP_PORT, '0.0.0.0'),
      pgPort: existing.pgPort || await freePort(DEFAULT_PG_PORT),
      dbPassword: existing.dbPassword || secret(),
      jwtSecret: existing.jwtSecret || secret(),
      settingsSecret: existing.settingsSecret || secret(),
    },
  };
  configStore.save(CONFIG_FILE, config);
  buildMenu();
  try {
    await startServerMode(firstAdmin);
    return { ok: true };
  } catch (err) {
    log('Server setup failed', err);
    if (!hasData) config = { ...config, mode: undefined };
    configStore.save(CONFIG_FILE, config);
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('sdm:retry', (event) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  boot();
});
ipcMain.handle('sdm:settings', (event) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  config = { ...config, mode: undefined };
  configStore.save(CONFIG_FILE, config);
  buildMenu();
  showPage('setup.html');
});
ipcMain.handle('sdm:open-logs', (event) => {
  if (!fromLocalPage(event)) throw new Error('Not allowed');
  shell.openPath(LOG_DIR);
});

// ---------- shutdown ----------
async function shutdown() {
  try {
    if (backend) await backend.close();
  } catch (err) {
    log('Server stop failed', err);
  }
  backend = null;
  try {
    if (database) await database.stop();
  } catch (err) {
    log('Database stop failed', err);
  }
  database = null;
}

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  if (backend || database) {
    e.preventDefault();
    shutdown().finally(() => app.quit());
  }
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  log(`${APP_NAME} ${app.getVersion()} starting (mode: ${config.mode || 'not set up'})`);
  createWindow();
  boot();
});
