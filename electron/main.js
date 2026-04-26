const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn, exec }  = require('child_process');
const path             = require('path');
const fs               = require('fs');
const http             = require('http');
const { autoUpdater }  = require('electron-updater');

// ─── Paths ────────────────────────────────────────────────────────────────────
// In production the parent project lands at resources/app/ via extraResources
const PROJECT_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');
const CONFIG_FILE  = path.join(__dirname, 'app-config.json');
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
  // Normalise to forward slashes so the same string works on all platforms
  const currentPath = PROJECT_ROOT.split(path.sep).join('/');

  // userData persists across updates and is always writable
  const patchRecord = path.join(app.getPath('userData'), 'path-config.json');
  let previousPath = ORIGINAL_DEV_PATH;
  if (fs.existsSync(patchRecord)) {
    try { previousPath = JSON.parse(fs.readFileSync(patchRecord, 'utf8')).data_dir || previousPath; } catch {}
  }

  if (currentPath === previousPath) return; // nothing to do

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

// ─── Config (password lives here) ────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaults = { password: 'changeme' };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
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
  // Win32: check classic install paths first
  const classic = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TradingView', 'TradingView.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'TradingView', 'TradingView.exe'),
    path.join(process.env.PROGRAMFILES || '', 'TradingView', 'TradingView.exe'),
  ];
  const found = classic.find(p => fs.existsSync(p));
  if (found) return found;
  // MSIX / Windows Store install — use PowerShell to get install location
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
  const tvPath = findTradingViewPath();
  if (!tvPath) {
    console.log('[ALA] TradingView not found — open manually with --remote-debugging-port=9222');
    return;
  }
  try {
    if (process.platform === 'win32') exec('taskkill /F /IM TradingView.exe', { timeout: 3000 });
    else exec('pkill -f "TradingView$"', { timeout: 3000 });
  } catch { /* not running */ }

  setTimeout(() => {
    const child = spawn(tvPath, ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('[ALA] TradingView launched with CDP on port 9222');
  }, 1000);
}

// ─── Start dashboard.js server ────────────────────────────────────────────────
// ELECTRON_RUN_AS_NODE=1 makes the Electron binary act as Node.js in packaged mode
let dashboardProcess = null;
function startDashboard() {
  dashboardProcess = spawn(process.execPath, [path.join(PROJECT_ROOT, 'dashboard.js')], {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
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
let loginWindow = null;
let mainWindow  = null;

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#060810',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  loginWindow.loadFile(path.join(__dirname, 'login.html'));
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
    },
  });
  mainWindow.loadURL(`http://localhost:${DASHBOARD_PORT}/live_dashboard.html`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC — password check ─────────────────────────────────────────────────────
ipcMain.handle('check-password', (_event, input) => {
  const config = loadConfig();
  return input === config.password;
});

ipcMain.on('login-success', async () => {
  try {
    await waitForDashboard();
    createMainWindow();       // open main FIRST
    loginWindow?.close();     // then close login — no window-all-closed gap
    loginWindow = null;
  } catch (e) {
    console.error('[ALA] Dashboard failed to start:', e.message);
    app.quit();
  }
});

ipcMain.on('quit-app', () => app.quit());

// ─── App lifecycle ────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return; // skip in dev
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  patchAgentPaths();
  startDashboard();
  launchTradingView();
  createLoginWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (dashboardProcess) dashboardProcess.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (dashboardProcess) dashboardProcess.kill();
});
