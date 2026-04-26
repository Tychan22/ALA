Run all three NQ signal agents in parallel.

Launch three subagents simultaneously using these instruction files:
- `/Users/tylerbittel/tradingview-mcp-jackson/agents/signal-agent.md`
- `/Users/tylerbittel/tradingview-mcp-jackson/agents/ilm-signal-agent.md`
- `/Users/tylerbittel/tradingview-mcp-jackson/agents/orb-signal-agent.md`

All three are controlled by the same `agent_enabled.mnq_signal` flag. Each agent:
1. Gates on trading hours (9:45–12:00 EDT weekdays only)
2. Checks daily loss limits and open positions
3. Reads TradingView live — scans for its specific setup
4. If a valid setup exists: logs to live_log.csv, draws on chart, pings Discord
5. If no setup: reports why in one line

Return each agent's output labeled by agent name.
