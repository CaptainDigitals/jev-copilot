---
description: Explain JEV Copilot configuration options, modes and where to set them.
---

Explain the JEV Copilot configuration to the user, concisely:

**Where to configure**: `/plugin` → JEV Copilot → Configure (values are stored by Claude Code; the OpenRouter key goes to the OS credential store). Environment fallbacks: `OPENROUTER_API_KEY`, `JEV_COPILOT_MODE`, `JEV_MODEL`, `JEV_COPILOT_COMPLETION_REVIEW`, `JEV_COPILOT_TOOL_GOVERNANCE`, `JEV_COPILOT_SESSION_BUDGET_USD`. Per-project overrides (thresholds, limits, mode, excluded paths, but never the key or endpoint) go in a `.jev-copilot.json` file at the project root.

**Modes**
- `off`: plugin inert.
- `assist`: advisory task profile on substantive prompts; no completion review, hard tool rules still ask.
- `enhance` (default): task profile + requirement contract on prompts, completion review when you stop after making changes (repair loop capped at 2), hard tool rules ask.
- `strict`: tighter completion thresholds, hard tool rules deny, JEV outage flags manual review instead of failing open.

**Key options**: `jev_model` (pinned `typesafe/jev-1.13` by default; `~typesafe/jev-latest` tracks releases and needs threshold re-validation), `completion_review_enabled`, `tool_governance_enabled` (adds JEV review to high-impact tool calls; read-only tools never go to JEV), `session_budget_usd` (optional JEV calls stop when exceeded; deterministic safety rules never depend on budget).

**Privacy**: only redacted prompt excerpts, file paths, compact summaries and diff metadata are sent to OpenRouter; `.env`, keys, certificates and credential paths are excluded; telemetry stores metadata only under the plugin data directory.

Point to `docs/CONFIGURATION.md` in the plugin repository for the full reference.
