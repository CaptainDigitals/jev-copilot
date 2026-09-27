---
description: Show JEV Copilot mode, model, API connectivity and session status.
allowed-tools: mcp__plugin_jev-copilot_jev__jev_status, Bash(node *)
---

Call the `jev_status` MCP tool (server `jev`) with `checkApi: true`. If the MCP server is unavailable, run `node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli.js" status` instead.

Present the result in this shape and nothing more:

```
JEV Copilot
Mode: <mode>
Provider: OpenRouter
Model: <model>
API: <connected | error (detail) | not-configured>
Completion review: <enabled|disabled>
Tool governance: <high-impact only | hard rules only>
Session: <task type>, <changed files> changed files, <requirements> requirements, <repairs> repairs
Calls: <n> (<cached> cached), avg latency <ms>, est. cost $<usd>
```

If the API is `not-configured`, tell the user to set the OpenRouter key in the plugin configuration (`/plugin` → JEV Copilot → Configure) or export `OPENROUTER_API_KEY`, and that Claude continues to work normally without it. Never print the key or any part of it.
