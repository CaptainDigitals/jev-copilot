# JEV Copilot for Claude Code — PRD Package

> **Historical note.** This is the overview that shipped with the original PRD package. The `starter-plugin/` scaffold it describes has been implemented and now lives at the repository root; see the top-level [README](../README.md) for install and usage, and [CONFIGURATION.md](CONFIGURATION.md) for the implemented options.

This package contains a comprehensive product requirements document and implementation starter scaffold for a Claude Code plugin that integrates TypeSafe JEV through OpenRouter as a fast, structured System-1 decision layer around Claude Code's generative/reasoning workflow.

## Package contents

- `docs/MASTER_PRD.md` — complete product requirements document
- `docs/ARCHITECTURE.md` — runtime architecture and request flows
- `docs/JEV_DECISION_CONTRACTS.md` — typed decision schemas and thresholds
- `docs/CLAUDE_CODE_INTEGRATION.md` — plugin, hooks, skills, commands, agents, MCP integration
- `docs/SECURITY_PRIVACY.md` — secrets, data handling, threat model and safe defaults
- `docs/TEST_AND_EVAL_PLAN.md` — unit, integration, regression and quality evaluation plan
- `docs/ROADMAP.md` — phased implementation and release plan
- `docs/BUILD_HANDOFF.md` — handoff instructions for Claude Code
- `starter-plugin/` — installable development scaffold to use as the implementation starting point

## Product thesis

JEV should not act as a second prose-generating model. It should act as a fast decision layer that performs bounded semantic judgments — routing, scoring, relevance selection, verification, risk estimation, and confidence-aware gating — while Claude performs planning, reasoning, code generation, tool use, and repair.

The plugin therefore uses a **hybrid design**:

1. Claude Code skills describe the collaboration protocol.
2. Claude Code hooks trigger JEV analysis at high-value lifecycle points.
3. A local Node runtime calls OpenRouter's JEV Decisions API.
4. Optional MCP tools expose explicit JEV operations to Claude.
5. Policy code decides when JEV advice is advisory, when it requires verification, and when it can gate completion or high-impact tool calls.
6. Telemetry records cost, latency, decisions and overrides locally without storing secrets.

## Development mode

Use the scaffold with Claude Code's plugin development workflow:

```bash
cd starter-plugin
npm install
npm run build
claude plugin validate . --strict
claude --plugin-dir .
```

The starter scaffold is intentionally conservative: it provides the plugin shape, config, command/skill definitions, decision contracts and runtime boundaries without pretending to be a finished production integration.

## Required secret

Configure an OpenRouter API key through Claude Code plugin user configuration or the `OPENROUTER_API_KEY` environment variable. Never commit keys to the repository.

## Default JEV model

Production default: `typesafe/jev-1.13` (pinned).

Optional tracking alias: `~typesafe/jev-latest`.

The pinned default avoids silent behavior changes that could invalidate calibrated thresholds.
