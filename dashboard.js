import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

const FILES = {
  strategies: join(__dirname, 'strategies.json'),
  rules:      join(__dirname, 'rules.json'),
  learning:   join(__dirname, 'mnq_learning.json'),
};

// GET /api/tv-status — probe TradingView CDP port 9222
import http from 'http';

// Version endpoint — must be before /api/:file wildcard
app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.ALA_VERSION || '1.0' });
});

// Launch TradingView with CDP port
app.post('/api/launch-tradingview', (_req, res) => {
  res.json({ ok: true });
  if (platform() === 'win32') {
    // Try COM activation via inline PowerShell (no file path issues)
    const TV_AUMID = '31178TradingViewInc.TradingView_q4jpyh43s5mv6!TradingView.Desktop';
    const psCmd = `
$pkg = Get-AppxPackage -Name '*TradingView*' -ErrorAction SilentlyContinue;
if ($pkg) {
  $manifest = Get-AppxPackageManifest $pkg;
  $appId = $manifest.Package.Applications.Application.Id;
  $aumid = "$($pkg.PackageFamilyName)!$appId";
} else { $aumid = '${TV_AUMID}'; }
$def = @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAAMgr { int ActivateApplication(string id, string args, int opts, out int pid); int b(string a, IntPtr b, string c, out int d); int c(string a, IntPtr b, out int c); }
[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"), ClassInterface(ClassInterfaceType.None)]
public class AAMgr {}
'@;
Add-Type -TypeDefinition $def;
$m = [IAAMgr]([AAMgr]::new()); $p = 0;
$m.ActivateApplication($aumid, '--remote-debugging-port=9222', 0, [ref]$p);
Write-Output "Launched PID $p"`.trim();
    const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'pipe' });
    ps.stdout.on('data', d => console.log('[TV launch]', d.toString().trim()));
    ps.stderr.on('data', d => console.error('[TV launch error]', d.toString().trim()));
  } else {
    const candidates = [
      '/Applications/TradingView.app/Contents/MacOS/TradingView',
      `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
    ];
    const tvPath = candidates.find(p => existsSync(p));
    if (tvPath) spawn(tvPath, ['--remote-debugging-port=9222'], { stdio: 'ignore', detached: true }).unref();
  }
});

app.get('/api/tv-status', (req, res) => {
  const probe = http.get('http://localhost:9222/json', (r) => {
    let data = '';
    r.on('data', chunk => data += chunk);
    r.on('end', () => {
      try {
        const tabs = JSON.parse(data);
        const tvTab = tabs.find(t => t.url && (t.url.includes('tradingview') || t.title?.toLowerCase().includes('tradingview')));
        res.json({ connected: true, tv_tab: !!tvTab, tabs: tabs.length });
      } catch(e) {
        res.json({ connected: false, tv_tab: false });
      }
    });
  });
  probe.on('error', () => res.json({ connected: false, tv_tab: false }));
  probe.setTimeout(1500, () => { probe.destroy(); res.json({ connected: false, tv_tab: false }); });
});

// GET /api/:file — read a JSON config file
app.get('/api/:file', (req, res) => {
  const fp = FILES[req.params.file];
  if (!fp) return res.status(404).json({ error: 'unknown file' });
  if (!existsSync(fp)) return res.status(404).json({ error: 'file not found' });
  try {
    res.json(JSON.parse(readFileSync(fp, 'utf8')));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/:file — write a JSON config file
app.post('/api/:file', (req, res) => {
  const fp = FILES[req.params.file];
  if (!fp) return res.status(404).json({ error: 'unknown file' });
  try {
    writeFileSync(fp, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Static files last (serves dashboard HTML, CSVs, screenshots, etc.)
app.use(express.static(__dirname));

app.listen(8080, () => {
  console.log('');
  console.log('  Dashboard  →  http://localhost:8080/live_dashboard.html');
  console.log('');
});
