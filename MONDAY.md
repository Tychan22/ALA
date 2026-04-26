# Monday Startup — Autonomous NQ Agent

## 1. Start TradingView with CDP
Run this once when you open your Mac:
```bash
~/tradingview-mcp-jackson/scripts/launch_tv_debug_mac.sh
```
Make sure NQ (IG:NASDAQ) is on the 3min chart with your indicators visible:
- ICT Killzones & Pivots [TFO]
- Play₿it EMA v2

**Enable Paper Trading in TradingView:**
- Open the trading panel (bottom of screen)
- Select "Paper Trading" as your broker/account
- Confirm account is active before starting agents

## 2. Start the dashboard server (if not running)
```bash
cd ~/tradingview-mcp-jackson && node dashboard.js &
```
Then open: http://localhost:8080/live_dashboard.html

> Note: use `node dashboard.js` not `python3 -m http.server` — the Node server enables saving from the Strategy tab.

## 3. Open Claude Code in the right directory
```bash
cd ~/tradingview-mcp-jackson && claude
```

## 4. Start all three agents (9:45 AM EDT)
Tell Claude:
> "start signal scan every 15 minutes, trade monitor every 90 seconds, and learning agent auto at 4pm"

Claude will set up three session crons:
- Signal agent every 15 min (gates to 9:45–12:00 EDT automatically)
- Trade monitor every 90s (gates to 9:30–12:30 EDT automatically)
- Learning agent at 4:02 PM daily (auto session debrief)

## 5. Stop scanning when done (after 12:00 PM EDT)
Tell Claude:
> "stop signal scan and trade monitor"

Learning agent fires automatically at 4pm — no action needed.

---

## What happens on a signal (fully autonomous)
1. Chart gets drawn on (entry/SL/TP lines)
2. Paper trade placed on TradingView (1x MNQ, limit order with SL + TP brackets)
3. New row appears in live_log.csv with result=open
4. Discord ping with all levels + R:R + dollar risk/reward
5. Trade monitor watches every 90s — closes position, updates CSV, pings Discord on exit
6. At 4pm — learning agent runs automatically, Discord session debrief sent

## Daily limits (auto-enforced)
| Limit | Amount | Behavior |
|-------|--------|----------|
| Daily loss limit | -$200 | Signal agent stops scanning. Monitor lets open trades run to exit. |
| Daily profit target | +$400 | Signal agent stops scanning. Monitor closes all open positions immediately. |
| Max open positions | 2 | Signal agent skips scan until one closes. |

## Dollar math (1x MNQ)
- 1 MNQ = $2 per point
- Typical stop: 30–60pts = $60–$120 risk per trade
- Typical target: 150–300pts = $300–$600 reward per trade
- Goal: 1:2 R:R per trade, $400 profit target per day

---

## Three agents, full autonomous loop

| Agent | Trigger | What it does |
|-------|---------|--------------|
| Signal Agent | every 15min, 9:45–12:00 | Scans → paper trade placed → logs → draws → Discord ping |
| Trade Monitor | every 90s, 9:30–12:30 | Watches price → closes paper trade → updates CSV → Discord ping |
| Learning Agent | auto 4:02pm weekdays | Reviews all trades → stats → violations → insights → Discord debrief |

---

## Manual commands (anytime)
- `"run signal scan"` — single immediate scan
- `"run trade monitor"` — single immediate price check
- `"run learning agent"` — immediate session debrief
- `"run learning agent post-trade note"` — enrich the last closed trade's notes

---

## Roadmap
- **Now:** Paper trading on TradingView, learning.json accumulates data
- **After ~3 months of live data:** If win rate and risk metrics prove out, wire Tradovate for live execution
