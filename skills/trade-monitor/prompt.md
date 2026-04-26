Run the NQ trade monitor.

Launch a subagent using the instructions in `/Users/tylerbittel/tradingview-mcp-jackson/agents/trade-monitor.md`.

The agent will:
1. Gate on market hours (9:30–12:30 EDT weekdays)
2. Find all open trades in live_log.csv (result=open or result=partial_mid)
3. Get current price from TradingView
4. Check each trade against SL, midpoint, and TP
5. On midpoint hit: update CSV to partial_mid, ping Discord (trade still running)
6. On final close: update CSV with result + pnl + screenshot, remove chart drawings, ping Discord

Returns nothing if no open trades or outside hours. Silent by design.
