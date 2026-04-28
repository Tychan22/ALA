const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn, exec }  = require('child_process');
const path             = require('path');
const fs               = require('fs');
const http             = require('http');
const crypto           = require('crypto');
const { autoUpdater }  = require('electron-updater');

// ─── Paths ────────────────────────────────────────────────────────────────────
// In production the parent project lands at resources/app/ via extraResources
const PROJECT_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');
const CONFIG_FILE  = path.join(app.getPath('userData'), 'app-config.json');
const DASHBOARD_PORT = 8080;

// ─── Cross-platform path patching ────────────────────────────────────────────
// Agent .md files contain absolute paths written on Tyler's dev machine.
// On first launch (or after a move/update), rewrite them to match this machine.
const ORIGINAL_DEV_PATH = '/Users/tylerbittel/tradingview-mcp-jackson';

function getAllMdFiles(dir) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...getAllMdFiles(full));
      else if (entry.name.endsWith('.md')) results.push(full);
    }
  } catch {}
  return results;
}

function patchAgentPaths() {
  const currentPath = PROJECT_ROOT.split(path.sep).join('/');

  const patchRecord = path.join(app.getPath('userData'), 'path-config.json');
  let previousPath = ORIGINAL_DEV_PATH;
  if (fs.existsSync(patchRecord)) {
    try { previousPath = JSON.parse(fs.readFileSync(patchRecord, 'utf8')).data_dir || previousPath; } catch {}
  }

  if (currentPath === previousPath) return;

  console.log(`[ALA] Patching agent paths: ${previousPath} → ${currentPath}`);
  const dirs = [path.join(PROJECT_ROOT, 'agents'), path.join(PROJECT_ROOT, 'skills')];
  for (const dir of dirs) {
    for (const file of getAllMdFiles(dir)) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes(previousPath)) {
        fs.writeFileSync(file, content.split(previousPath).join(currentPath));
        console.log(`[ALA]  patched ${path.relative(PROJECT_ROOT, file)}`);
      }
    }
  }

  fs.writeFileSync(patchRecord, JSON.stringify({ data_dir: currentPath }, null, 2));
}

// ─── License key verification ─────────────────────────────────────────────────
const _K = ['ALA-TRADER', '-2026-MASTER', '-SECRET-V2'];
const SECRET = _K.join('');

function verifyKey(key) {
  const parts = (key || '').toUpperCase().trim().split('-');
  if (parts.length !== 4) return false;
  const [tag, a, b, c] = parts;
  if (tag.length !== 8 || a.length !== 4 || b.length !== 4 || c.length !== 4) return false;
  const hex = crypto.createHmac('sha256', SECRET).update(tag).digest('hex').toUpperCase();
  const expected = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
  const provided  = `${a}-${b}-${c}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch { return false; }
}

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function saveConfig(data) {
  const existing = loadConfig();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function hasValidConfig() {
  const cfg = loadConfig();
  return !!(cfg.licenseKey && cfg.anthropicKey && verifyKey(cfg.licenseKey));
}

// ─── Launch TradingView with CDP port ────────────────────────────────────────
function findTradingViewPath() {
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/TradingView.app/Contents/MacOS/TradingView',
      `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
    ];
    return candidates.find(p => fs.existsSync(p)) || null;
  }
  const classic = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TradingView', 'TradingView.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'TradingView', 'TradingView.exe'),
    path.join(process.env.PROGRAMFILES || '', 'TradingView', 'TradingView.exe'),
  ];
  const found = classic.find(p => fs.existsSync(p));
  if (found) return found;
  try {
    const loc = require('child_process')
      .execSync(`powershell -command "(Get-AppxPackage -Name 'TradingView.Desktop').InstallLocation"`, { timeout: 5000 })
      .toString().trim();
    if (loc) {
      const exePath = path.join(loc, 'TradingView.exe');
      if (fs.existsSync(exePath)) return exePath;
    }
  } catch {}
  return null;
}

function launchTradingView() {
  if (process.platform === 'win32') {
    try { exec('taskkill /F /IM TradingView.exe', { timeout: 3000 }); } catch {}
    setTimeout(() => {
      const script = path.join(PROJECT_ROOT, 'launch_tv.ps1');
      const ps = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'pipe' });
      ps.stdout.on('data', d => console.log('[ALA] TradingView UWP COM, PID:', d.toString().trim()));
      ps.stderr.on('data', d => console.log('[ALA] TradingView launch error:', d.toString().trim()));
    }, 1000);
    return;
  }

  const tvPath = findTradingViewPath();
  if (!tvPath) {
    console.log('[ALA] TradingView not found — open manually with --remote-debugging-port=9222');
    return;
  }
  try { exec('pkill -f "TradingView$"', { timeout: 3000 }); } catch {}
  setTimeout(() => {
    const child = spawn(tvPath, ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('[ALA] TradingView launched with CDP on port 9222');
  }, 1000);
}

// ─── Start dashboard.js server ────────────────────────────────────────────────
let dashboardProcess = null;
function startDashboard() {
  dashboardProcess = spawn(process.execPath, [path.join(PROJECT_ROOT, 'dashboard.js')], {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ALA_VERSION: app.getVersion(), ALA_USER_DATA: app.getPath('userData') }
  });
  dashboardProcess.stdout.on('data', d => console.log('[dashboard]', d.toString().trim()));
  dashboardProcess.stderr.on('data', d => console.error('[dashboard]', d.toString().trim()));
  dashboardProcess.on('exit', code => console.log('[dashboard] exited', code));
}

// ─── Wait for dashboard to be ready ──────────────────────────────────────────
function waitForDashboard(retries = 20) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      http.get(`http://localhost:${DASHBOARD_PORT}/live_dashboard.html`, res => {
        if (res.statusCode === 200) resolve();
        else tryAgain(n);
      }).on('error', () => tryAgain(n));
    };
    const tryAgain = (n) => {
      if (n <= 0) reject(new Error('Dashboard did not start'));
      else setTimeout(() => check(n - 1), 500);
    };
    check(retries);
  });
}

// ─── Windows ──────────────────────────────────────────────────────────────────
let setupWindow = null;
let mainWindow  = null;

function createSetupWindow(mode = 'setup') {
  setupWindow = new BrowserWindow({
    width: 440,
    height: mode === 'loading' ? 280 : 420,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#060810',
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      contextIsolation: true,
    },
  });
  // Pass mode as hash so the renderer can set initial state before first paint
  setupWindow.loadFile(path.join(__dirname, 'setup.html'), { hash: mode });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#060810',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-main.js'),
    },
  });
  mainWindow.loadURL(`http://localhost:${DASHBOARD_PORT}/live_dashboard.html`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Launch sequence (shared between first-run and subsequent runs) ───────────
async function launchApp() {
  try {
    launchTradingView();
    setupWindow?.webContents.send('setup-status', 'Starting dashboard...');
    await waitForDashboard();
    createMainWindow();
    setupWindow?.close();
    setupWindow = null;
  } catch (e) {
    console.error('[ALA] Dashboard failed to start:', e.message);
    app.quit();
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('validate-license', (_event, key) => verifyKey(key));

ipcMain.handle('save-setup', (_event, { licenseKey, anthropicKey }) => {
  if (!verifyKey(licenseKey)) return { ok: false, error: 'Invalid license key' };
  saveConfig({ licenseKey, anthropicKey });
  // Switch setup window to loading state, then launch async
  setupWindow?.webContents.send('set-mode', 'loading');
  setImmediate(() => launchApp());
  return { ok: true };
});

ipcMain.on('quit-app', () => app.quit());

// ─── Auto-updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Tychan22',
    repo: 'ALA',
    releaseType: 'release',
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of ALA Trader has been downloaded. Restart to apply the update.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.checkForUpdates().catch(err => console.log('[ALA] Update check failed:', err.message));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  patchAgentPaths();
  startDashboard();
  setupAutoUpdater();

  if (hasValidConfig()) {
    createSetupWindow('loading');
    launchApp();
  } else {
    createSetupWindow('setup');
  }
});

app.on('window-all-closed', () => {
  if (dashboardProcess) dashboardProcess.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (dashboardProcess) dashboardProcess.kill();
});
