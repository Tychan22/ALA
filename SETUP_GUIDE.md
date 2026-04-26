# Setup Guide

This guide covers installation of both the TradingView MCP server and the full ALA (Autonomous Learning AI) trading system built on top of it.

---

## Part 1 — TradingView MCP Server

### Step 1: Clone and Install

```bash
git clone https://github.com/LewisWJackson/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
npm install
```

If the user specifies a different install path, use that instead of `~/tradingview-mcp-jackson`.

### Step 2: Set Up Rules

Copy the example rules file:

```bash
cp ~/tradingview-mcp-jackson/rules.example.json ~/tradingview-mcp-jackson/rules.json
```

Open `rules.json` and fill in:
- `alerts.discord_webhook` — your Discord webhook URL
- `agent_enabled` — set `mnq_signal`, `gold_signal`, `trade_monitor`, `learning_agent` to `true`/`false`
- `mnq.symbol` — NQ chart symbol (e.g. `IG:NASDAQ` for CFD, `CME_MINI_DL:MNQ1!` for micros)
- `mnq.paper_trading` — contracts, point_value, daily limits, target_risk_usd
- `gold.symbol` — Gold chart symbol (e.g. `FOREXCOM:XAUUSD`)
- `gold.paper_trading` — same fields for the Gold pipeline

**To swap instruments** — only change `mnq.symbol` or `gold.symbol`. All agents read from there at runtime.

### Step 3: Add to MCP Config

Add the server to `~/.claude/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/tradingview-mcp-jackson/src/server.js"]
    }
  }
}
```

Replace `YOUR_USERNAME` with the actual system username (`echo $USER` on Mac).

If the config already has other servers, merge the `tradingview` entry into the existing `mcpServers` object — do not overwrite others.

### Step 4: Launch TradingView Desktop

TradingView Desktop must be running with Chrome DevTools Protocol enabled.

**Auto-detect and launch (recommended):** Use the `tv_launch` MCP tool — it auto-detects TradingView on Mac, Windows, and Linux.

**Manual launch:**

Mac:
```bash
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

Windows:
```bash
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

Linux:
```bash
/opt/TradingView/tradingview --remote-debugging-port=9222
```

### Step 5: Restart Claude Code

The MCP server only loads at startup:

1. Exit Claude Code (`Ctrl+C`)
2. Relaunch Claude Code
3. The tradingview MCP tools will be available

### Step 6: Verify Connection

Use `tv_health_check`. Expected:

```json
{
  "success": true,
  "cdp_connected": true,
  "chart_symbol": "...",
  "api_available": true
}
```

If `cdp_connected: false` — TradingView is not running or CDP port 9222 is blocked.

---

## Part 2 — ALA Trading System

### Step 7: Initialize CSV Log Files

Create empty log files with the correct headers:

**live_log.csv** and **backtest_log.csv** (same headers):
```
date,ticker,timeframe,mode,bias,ema_position,session_draw,bsl,ssl,midpoint,entry_type,entry,stop,target,rr,result,pnl,screenshot_before,screenshot_after,notes
```

### Step 8: Set Up the Live Dashboard

The dashboard is a local Node.js server that displays all trade data, learning stats, and agent pipeline status.

Start it (use nohup so it persists):
```bash
cd ~/tradingview-mcp-jackson
nohup node dashboard.js > /tmp/dashboard.log 2>&1 &
```

Open in browser: `http://localhost:8080/live_dashboard.html`

The dashboard reads from:
- `live_log.csv` — live trades
- `backtest_log.csv` — backtest trades
- `mnq_learning.json` — NQ learning stats (Monte Carlo, insights, session history)
- `gold_learning.json` — Gold learning stats
- `agent_status.json` — agent heartbeats (powers pipeline glow indicators)

Click the **`?` button** (next to the instrument badge) to view all ALA commands from inside the dashboard.

### Step 9: Set Up TradingView Chart

1. Load or create a chart layout with:
   - **Play₿it EMA v2** — EMA band for bias detection (MA Top / MA Bottom)
   - **ICT Killzones & Pivots [TFO]** — session highs/lows (AS.H, AS.L, LO.H, LO.L, NYAM.H, NYAM.L)
   - **Gold Signal Scanner** — Pine script that detects Gold TL + EMA breakout signals. Must be on the 15min XAUUSD chart and visible for the Gold signal agent to work. Add it to the chart, then save the layout so it persists across sessions.

2. Set up a Paper Trading account inside TradingView (broker: Paper Trading)

3. Save the layout — all indicators reload automatically each session

### Step 10: Install CLI (Optional)

```bash
cd ~/tradingview-mcp-jackson
npm link
```

Then `tv status`, `tv quote`, `tv pine compile`, etc. work from anywhere.

---

## Part 3 — Session Commands

### Live Session

| Command | Action |
|---|---|
| `start ALA` | Launch TradingView + start dashboard server + open browser |
| `mnq on` | Create NQ crons: signal (9:45 AM + every 3 min), trade monitor (every 5 min), learning agent (12 PM) |
| `mnq off` | Delete all NQ crons |
| `gold on` | Create Gold crons: signal (8 PM + every 10 min), trade monitor (every 5 min), learning agent (12 AM) |
| `gold off` | Delete all Gold crons |
| `save` | Save TradingView session state |
| `cleanse` | Remove all drawings from the chart |

**Startup sequence:**
1. `start ALA` → TradingView + dashboard open
2. `mnq on` → NQ pipeline starts at 9:45 AM EDT
3. `gold on` → Gold pipeline starts at 8:00 PM EDT

**Cron schedules (local time):**
- **NQ:** Signal 9:45 AM + every 3 min to 11:57 AM · Trade monitor every 5 min 9:45 AM–noon · Learning agent 12 PM
- **Gold:** Signal 8 PM + every 10 min to midnight · Trade monitor every 5 min 8 PM–midnight · Learning agent 12 AM

Note: NQ and Gold trade monitors are separate crons scoped to their own session windows.

### Backtest Session

| Command | Action |
|---|---|
| `backtest on` | Switch logging to `backtest_log.csv`, disable all active crons |
| `backtest off` | Switch logging back to `live_log.csv` |
| `pic1` | BEFORE screenshot — reads drawn levels (entry/SL/TP), auto-detects setup type + bias + EMA position, logs open row |
| `pic2` | AFTER screenshot — reads PnL, analyzes both screenshots visually, writes brain note, closes trade |
| `cancel trade` | Remove pending open row, clear state |
| `correct setup {type}` | Override the auto-detected setup type if wrong |

**Backtest workflow:**
1. `backtest on`
2. Enter TradingView replay mode manually
3. Find a setup, draw entry/SL/TP lines on chart
4. `pic1` — logs the trade with auto-detected setup type
5. Let the trade play out in replay
6. `pic2` — closes, analyzes, logs result + brain notes

---

## Part 4 — Brain & Learning System

### Trade Brain (automatic on every close)

After every live or backtest trade closes, the brain:
1. Reads both before and after screenshots visually
2. Identifies setup quality, entry candle, liquidity sweep, what happened and why
3. Writes an enriched note to the CSV `notes` field
4. Includes the analysis in the Discord close notification

NQ and Gold use separate setup vocabularies:
- **NQ:** `res_breakout`, `support_sweep`, `double_top`, `support_break`
- **Gold:** `trendline_breakout_long`, `trendline_breakout_short`, `ema_breakout`

For backtests, `pic1` auto-detects the setup type from the before screenshot. Say `correct setup {type}` if it's wrong.

### Learning Agent

Runs automatically at session end (12 PM for NQ, 12 AM for Gold). Also runnable manually.

Reads from **both** `live_log.csv` and `backtest_log.csv` — backtest data is included in all stats and Monte Carlo to build sample size faster. Insights are tagged with live confirmation count:

- `[3 live / 5 backtest]` — confirmed across both
- `[0 live / 5 backtest — not yet live confirmed]` — directional only

Also scans the `notes` field for recurring language patterns across wins and losses:
- "same level stopped prior" appearing in losses → surfaces as a rule violation pattern
- "textbook body" appearing in wins → surfaces as a confirming condition

Writes to:
- `mnq_learning.json` — NQ stats, Monte Carlo, insights, session history
- `gold_learning.json` — Gold stats, Monte Carlo, insights, session history

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `cdp_connected: false` | Launch TradingView with `--remote-debugging-port=9222` or use `tv_launch` |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server not in Claude Code | Check `~/.claude/settings.json` syntax, restart Claude Code |
| `tv` command not found | Run `npm link` from the project directory |
| Dashboard not loading | Run `nohup node dashboard.js > /tmp/dashboard.log 2>&1 &`, then open `localhost:8080/live_dashboard.html` |
| Dashboard shows wrong ticker | Click the correct ticker button (NQ / GOLD) in the header |
| Screenshots not found in modal | Ensure paths in CSV are relative: `screenshots/filename.png` not absolute |
| Gold Signal Scanner table empty | Ensure indicator is visible on 15min XAUUSD chart — add it and save the layout |
| Pine Editor tools fail | Open Pine Editor panel first: `ui_open_panel pine-editor open` |
| Agent heartbeat not updating | Check `agent_status.json` — timestamps show last run time |
| `pic1` wrong setup type | Say `correct setup {type}` to override |

---

## Key Files

| File | Purpose |
|---|---|
| `rules.json` | Single source of truth — symbols, risk params, Discord webhook, agent toggles. NQ config under `mnq.{}`, Gold under `gold.{}` |
| `live_log.csv` | All live trades (open, closed, partial) with brain notes |
| `backtest_log.csv` | Backtest trades — same format, feeds learning agent |
| `backtest_state.json` | Tracks pending trade between pic1 and pic2 |
| `mnq_learning.json` | NQ stats, Monte Carlo, insights, session history |
| `gold_learning.json` | Gold stats, Monte Carlo, insights, session history |
| `agent_status.json` | Agent heartbeat timestamps (powers dashboard glow) |
| `strategies.json` | Strategy definitions and setup types for dashboard |
| `agents/signal-agent.md` | NQ signal scanner agent |
| `agents/gold-signal-agent.md` | Gold signal scanner agent (TL breakout + EMA breakout) |
| `agents/trade-monitor.md` | Trade monitor + brain analysis for NQ and Gold |
| `agents/learning-agent.md` | Post-session learning agent (reads both CSVs) |
| `agents/backtest-agent.md` | pic1/pic2 backtest logging agent |
| `CLAUDE.md` | MCP tool decision tree (auto-loaded by Claude Code) |
