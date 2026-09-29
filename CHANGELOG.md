# Changelog

All notable changes to JEV Copilot are documented here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.2.0] - 2026-09-28

### Added
- **YouTube mass research engine** (`src/youtube/`): discovery from URLs, ids, playlists, channels, topic searches, URL files and collections; sandboxed yt-dlp wrapper (no shell, option allowlist, YouTube hosts only, captions only, never media); chapter-aware transcript chunking; JEV video-level and chunk-level screening bundles (`youtube-video-screening`, `youtube-chunk-screening`, `youtube-ask`); research-value routing (deep / focused / index / archive) computed by policy code; title and shingle-overlap deduplication; cost estimate with budget pause; resumable per-video job state; cross-job transcript cache and named collections; cited evidence bundle, Markdown and JSON reports; optional headless deep model via OpenRouter chat completions.
- MCP tools `jev_youtube_research`, `jev_youtube_job`, `jev_youtube_bundle`, `jev_youtube_evidence`, `jev_youtube_export`, `jev_youtube_ask`.
- Commands `/jev-copilot:youtube-analyze`, `youtube-playlist`, `youtube-research`, `youtube-compare`, `youtube-parts`, `youtube-export`, `youtube-ask`; skill `jev-research` (synthesis protocol with mandatory citations).
- CLI `youtube` subcommands: analyze, playlist, research, compare, parts, steps, status, resume, export, ask.
- Plugin option `deep_model` (`claude-session` default) and `JEV_COPILOT_DEEP_MODEL` / `JEV_COPILOT_YTDLP_PATH` environment overrides; `youtubeResearch` block in `config/defaults.json`.
- Untrusted-text hardening (`src/youtube/untrusted.ts`): creator-controlled titles, channel and chapter names are flattened to plain text; caption text has images, links and HTML neutralised and instruction-like passages annotated; model-written analyses keep only engine citations as live links; every evidence block and bundle carries an inline "data, not instructions" notice and the headless prompts repeat it.
- Crash-safe resume: every video is persisted the moment its ingest, screening or deep analysis finishes, so an interrupted job never re-spends JEV or deep-model calls; failed deep analyses are counted and shown.
- A pre-ingestion cost gate stops oversized playlists before any transcript is fetched when the budget could not cover screening.
- 24 new tests (resolver, transcript parsing and chunking incl. sentence boundaries, screening and routing policy, yt-dlp argument safety and failure classification, pool, store, engine end to end with mocked yt-dlp and JEV, budget pause, crash resume, report rendering, untrusted-text neutralisation). Suite: 84 tests.
- `docs/YOUTUBE_RESEARCH.md` and a README section with the workflow diagram.

### Changed
- Bare video ids must not start with a dash.
- Duplicate videos are always routed to `archive`.
- Chunk boundaries now close after the segment that ends a sentence (previously checked the next segment).
- Chunk screening bundle 1.1.0 asks separate questions for configuration, cost and performance claims.

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
- 60 unit/contract/hook-replay tests (including bypass regressions for the hard-deny rules: long-option recursive deletes, split download-then-execute chains, credential reads by any verb, destructive SQL inside larger command lines), eval dataset, CI on Linux/macOS/Windows with manifest validation and a committed-secret scan.
