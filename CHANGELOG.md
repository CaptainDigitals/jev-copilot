# Changelog

All notable changes to JEV Copilot are documented here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.1.0] - 2026-09-26

First installable release.

### Added
- Claude Code plugin packaging: manifest with secure `userConfig` (sensitive OpenRouter key), single-plugin marketplace, hooks, commands, skills, verifier agent and a zero-dependency stdio MCP server.
- Dependency-free OpenRouter Decisions API client with HTTPS/host allowlist, bounded timeout and retries, rate-limit handling, size guard, schema validation and redacted errors.
- Versioned question bundles: task analysis, context relevance, completion review (with per-requirement coverage), tool action.
- Policy engine: confidence bands, strategy mapping, context bands, completion pass/repair with structured deficiencies, deterministic tool-risk classifier with non-overridable hard rules.
- Hooks: `SessionStart`, `UserPromptSubmit` (task profile + requirement contract), `PreToolUse` (hard rules always; JEV supplement when governance is enabled), `PostToolUse` (change and test-evidence tracking, no JEV), `Stop` (completion review with capped repair loop), `SessionEnd`.
- Content-addressed decision cache, metadata-only JSONL telemetry, session budget.
- Outbound secret redaction and path exclusion policy.
- Deterministic repository context discovery (git, keywords, recent changes) feeding JEV ranking.
- CLI (`dist/src/cli.js`) for status, analyze, context, review, assess, stats, eval and redaction checks.
- 56 unit/contract/hook-replay tests, eval dataset, CI on Linux/macOS/Windows with manifest validation and a committed-secret scan.
