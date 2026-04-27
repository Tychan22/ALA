import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Agent helpers ─────────────────────────────────────────────────────────────
function findClaude() {
  const candidates = [
    process.env.HOME && `${process.env.HOME}/.local/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || 'claude';
}
const CLAUDE_BIN = findClaude();

function agentPrompt(file) {
  const raw = readFileSync(join(__dirname, 'agents', file), 'utf8');
  const m = raw.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/);
  return m ? m[1].trim() : raw;
}

function readRules() {
  try { return JSON.parse(readFileSync(join(__dirname, 'rules.json'), 'utf8')); } catch { return {}; }
}

// ─── Autonomous scheduler ──────────────────────────────────────────────────────
const agentLastRun = {};

function nycNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function isWeekday(d) { const w = d.getDay(); return w >= 1 && w <= 5; }
function minsOf(d)    { return d.getHours() * 60 + d.getMinutes(); }

const SCHED = {
  mnq_signal:  { key: 'mnq_signal',  start: 9*60+45, end: 12*60,    interval: 3*60*1000,          file: 'signal-agent.md',   prompt: 'Run signal scan' },
  mnq_monitor: { key: 'mnq_signal',  start: 9*60+30, end: 16*60,    interval: 5*60*1000,          file: 'trade-monitor.md',  prompt: 'Run trade monitor' },
  learning:    { key: '_any',         start: 16*60+32, end: 16*60+37, interval: 23*60*60*1000,     file: 'learning-agent.md', prompt: 'Run learning agent' },
};

function spawnAgent(label, file, prompt) {
  let system;
  try { system = agentPrompt(file); } catch (e) { console.error(`[scheduler] cannot read ${file}:`, e.message); return; }
  console.log(`[ALA scheduler] → ${label}`);
  agentLastRun[label] = Date.now();
  const child = spawn(CLAUDE_BIN, [
    '--print', '--output-format', 'text',
    '--system-prompt', system,
    '--dangerously-skip-permissions',
    '-p', prompt,
  ], { cwd: __dirname, env: { ...process.env }, stdio: 'pipe' });
  child.stdout.on('data', d => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${label}!] ${d}`));
  child.on('close', code => console.log(`[ALA scheduler] ${label} done (${code})`));
}

function tickScheduler() {
  const nyc = nycNow();
  if (!isWeekday(nyc)) return;
  const min = minsOf(nyc);
  const enabled = readRules().agent_enabled || {};
  const now = Date.now();

  for (const [label, cfg] of Object.entries(SCHED)) {
    if (min < cfg.start || min >= cfg.end) continue;
    const on = cfg.key === '_any' ? (enabled.mnq_signal || enabled.gold_signal) : enabled[cfg.key];
    if (!on) continue;
    if (now - (agentLastRun[label] || 0) < cfg.interval) continue;
    spawnAgent(label, cfg.file, cfg.prompt);
  }
}

setInterval(tickScheduler, 60_000);

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
  let version = process.env.ALA_VERSION;
  if (!version || version === 'undefined') {
    try { version = JSON.parse(readFileSync(join(__dirname, 'electron', 'package.json'), 'utf8')).version; } catch {}
  }
  res.json({ version: version || '1.0' });
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

// POST /api/command — run a backtest command via spawned claude subprocess
app.post('/api/command', (req, res) => {
  const { command } = req.body;
  const cmd = command?.trim().toLowerCase();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sseText = t => res.write(`data: ${JSON.stringify({ text: t })}\n\n`);
  const sseDone = ()  => { res.write('data: [DONE]\n\n'); res.end(); };

  // Simple state toggles — no agent spawn needed
  if (cmd === 'backtest on' || cmd === 'backtest off') {
    const stateFile = join(__dirname, 'backtest_state.json');
    const active = cmd === 'backtest on';
    try {
      const s = JSON.parse(readFileSync(stateFile, 'utf8'));
      s.active = active;
      writeFileSync(stateFile, JSON.stringify(s, null, 2));
    } catch {
      writeFileSync(stateFile, JSON.stringify({ active, pending_trade: null }, null, 2));
    }
    sseText(active ? '[BACKTEST] Mode ON — say pic1 to log your first setup.' : '[BACKTEST] Mode OFF.');
    return sseDone();
  }

  const allowed = ['pic1', 'pic2', 'cancel', 'cancel trade'];
  if (!allowed.includes(cmd)) {
    sseText('Unknown command: ' + command);
    return sseDone();
  }

  let system;
  try { system = agentPrompt('backtest-agent.md'); }
  catch (e) { sseText('Error loading backtest agent: ' + e.message); return sseDone(); }

  const child = spawn(CLAUDE_BIN, [
    '--print',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--system-prompt', system,
    '--dangerously-skip-permissions',
    '-p', command.trim(),
  ], { cwd: __dirname, env: { ...process.env } });

  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text)
          res.write(`data: ${JSON.stringify({ text: ev.delta.text })}\n\n`);
      } catch {}
    }
  });
  child.on('close', () => sseDone());
});

// POST /api/claude — stream a Claude response
app.post('/api/claude', async (req, res) => {
  let apiKey;
  try {
    const cfg = JSON.parse(readFileSync(join(__dirname, 'electron', 'app-config.json'), 'utf8'));
    apiKey = cfg.anthropicKey;
  } catch {}
  if (!apiKey) return res.status(400).json({ error: 'No Anthropic API key set in app-config.json' });

  const { messages } = req.body;

  // Build rich context snapshot
  const ctx = [];
  try {
    ctx.push('## Strategies & Rules');
    ctx.push(JSON.stringify(JSON.parse(readFileSync(FILES.strategies, 'utf8')), null, 2));
    ctx.push(JSON.stringify(readRules(), null, 2));
  } catch {}
  try {
    const learning = JSON.parse(readFileSync(FILES.learning, 'utf8'));
    ctx.push('\n## MNQ Learning Summary');
    ctx.push(`Win rate: ${learning.win_rate ?? '—'} | Trades: ${learning.total_trades ?? 0} | Avg RR: ${learning.avg_rr ?? '—'}`);
    if (learning.insights?.length) ctx.push('Insights: ' + learning.insights.slice(-3).join(' | '));
  } catch {}
  try {
    const goldL = JSON.parse(readFileSync(join(__dirname, 'gold_learning.json'), 'utf8'));
    ctx.push('\n## Gold Learning Summary');
    ctx.push(`Win rate: ${goldL.win_rate ?? '—'} | Trades: ${goldL.total_trades ?? 0}`);
  } catch {}
  try {
    const status = JSON.parse(readFileSync(join(__dirname, 'agent_status.json'), 'utf8'));
    ctx.push('\n## Agent Last-Run Times');
    for (const [k, v] of Object.entries(status)) ctx.push(`${k}: ${v ?? 'never'}`);
  } catch {}
  try {
    const csv = readFileSync(join(__dirname, 'live_log.csv'), 'utf8').trim().split('\n');
    const recent = csv.slice(-11).join('\n'); // header + last 10
    ctx.push('\n## Recent Live Trades (last 10 rows)');
    ctx.push(recent);
  } catch {}

  const context = ctx.join('\n');
  const system = `You are ALA (Autonomous Learning AI), a personal AI trading assistant embedded in the ALA Trader dashboard. You know the user's full trading system state — strategies, rules, recent trades, learning insights, and agent status. Be concise and direct. Today is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.\n\n${context}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 2048, stream: true, system, messages }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          if (p.type === 'content_block_delta' && p.delta?.text)
            res.write(`data: ${JSON.stringify({ text: p.delta.text })}\n\n`);
        } catch {}
      }
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// POST /api/:file — write a JSON config file (wildcard — must stay after all specific POST routes)
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
