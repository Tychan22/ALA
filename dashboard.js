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
  res.json({ ok: true }); // respond immediately, launch is async
  if (platform() === 'win32') {
    const script = join(__dirname, 'launch_tv.ps1');
    spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore', detached: true }).unref();
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
