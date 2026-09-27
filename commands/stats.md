---
description: Show local JEV Copilot usage, latency, cost and decision statistics for this session.
allowed-tools: mcp__plugin_jev-copilot_jev__jev_session_stats
---

Call `jev_session_stats` and present a compact table: calls (and cached), failures, average latency, estimated input tokens, estimated cost in USD, completion repairs, tool escalations, low-confidence fallbacks, context candidates evaluated vs. selected.

This is local metadata only. Never display API keys, raw prompts or source text.
