Run the NQ learning agent.

Launch a subagent using the instructions in `/Users/tylerbittel/tradingview-mcp-jackson/agents/learning-agent.md`.

The agent will:
1. Load all closed trades from backtest_log.csv and live_log.csv
2. Compute win rates by entry type, EMA position, session range, and direction
3. Check each trade for rule violations (momentum, session range, RR compliance)
4. Generate data-driven insights about what's working and what isn't
5. Write a persistent mnq_learning.json with stats, violations, insights, and suggested rule tweaks
6. Send a Discord session debrief embed
7. Append session to session_history in mnq_learning.json

Run this after each live session ends (12:30 PM EDT or later), or anytime manually.

For a post-trade note on the most recent closed trade only, say: "run learning agent post-trade note"
