Run the NQ signal agent.

Launch a subagent using the instructions in `/Users/tylerbittel/tradingview-mcp-jackson/agents/signal-agent.md`.

The agent will:
1. Gate on trading hours (9:45–12:00 EDT weekdays only)
2. Check daily loss limits and open positions
3. Read TradingView live — price, session levels, EMA band
4. Apply draw-on-liquidity rules
5. If a valid setup exists: log to live_log.csv, draw on chart, ping Discord
6. If no setup: report why in one line

Return the agent's final output directly.
