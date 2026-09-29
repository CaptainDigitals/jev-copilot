<p align="center">
  <img src="assets/jev-copilot-hero.jpg" alt="JEV Copilot Plugin: JEV linked to Claude Code" width="100%">
</p>

<h1 align="center">JEV Copilot for Claude Code</h1>

<p align="center">
  A fast, typed <strong>System-1 decision layer</strong> for Claude Code, powered by <a href="https://typesafe.ai">TypeSafe JEV</a> through <a href="https://openrouter.ai/typesafe/jev-1.13">OpenRouter</a>.<br>
  JEV judges. Claude reasons, plans, writes and repairs.
</p>

<p align="center">
  <a href="https://github.com/CaptainDigitals/jev-copilot/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/CaptainDigitals/jev-copilot/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white">
  <img alt="Zero runtime dependencies" src="https://img.shields.io/badge/runtime%20deps-0-blue">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

---

## What it does

Claude Code makes dozens of small, bounded decisions per task: *is this a bug fix or a refactor? which of these twenty files matter? are tests required? is this command destructive? did I actually cover every requirement?* Using a full reasoning model for each of them is slow and expensive; hard-coded rules are brittle because the decisions are semantic.

JEV Copilot routes those decisions to JEV, a decision model that returns **typed answers with probabilities** (`choice`, `noul` yes/no, ordered `score`) in tens of milliseconds for fractions of a cent. Policy code in the plugin turns the answers into deterministic behavior. Claude keeps doing everything open-ended.

```text
User intent
   │
   ▼
JEV System-1 ─ task type · complexity · scope · tests · security · ambiguity
   │
   ▼
Claude System-2 ─ plan · read · edit · test · explain
   │
   ▼
JEV verification ─ requirement coverage · regression · security · completion
   ├── pass ──▶ final response
   └── repair ▶ structured deficiencies ──▶ Claude fixes only what is missing (capped loop)
```

### Automatic behavior (hooks)

| When | What happens | Cost |
|---|---|---|
| You submit a substantive prompt | One JEV call classifies the task and injects a 7-line advisory profile plus a requirement contract (explicit items verbatim, inferred items marked) | ~$0.00002 |
| Claude edits files or runs tests | Local change and test-evidence tracking. No JEV call. | $0 |
| Claude is about to run a tool | Deterministic risk classifier. Hard rules (deletes at roots/home/system paths, private-key and credential-store access, download-then-execute chains in any form, permission broadening, destructive SQL) ask for confirmation in `enhance` and deny in `strict`. With governance enabled, high-impact actions get a JEV second opinion. Read-only tools never touch JEV. | $0 or ~$0.00002 |
| Claude stops after making changes | Completion review: requirement coverage, completeness, test sufficiency, regression and security likelihood. Fails → Claude receives structured deficiencies and repairs (cap: 2 loops). | ~$0.00003 |

Terminal output stays minimal:

```text
JEV: feature / high / tests recommended / security-sensitive / confidence 93%
...
JEV review: repair required (2 items)
```

### Explicit tools and commands

| Command | MCP tool | Purpose |
|---|---|---|
| `/jev-copilot:status` | `jev_status` | Mode, model, connectivity, session state |
| `/jev-copilot:analyze [task]` | `jev_analyze_task` | Typed task profile + strategy + requirement contract |
| `/jev-copilot:plan [task]` | analyze + context | JEV-informed implementation plan before editing |
| `/jev-copilot:context [task]` | `jev_context`, `jev_rank_context` | Deterministic candidate discovery, JEV relevance ranking |
| `/jev-copilot:review [claim]` | `jev_review_completion` | Completion review on demand |
| `/jev-copilot:stats` | `jev_session_stats` | Calls, cache hits, latency, cost, repairs |
| `/jev-copilot:config-help` | – | Explains modes and options |
| `/jev-copilot:youtube-*` | `jev_youtube_*` | YouTube mass research (see below) |
| – | `jev_assess_tool_action` | Risk-classify a proposed tool call |
| `@agent-jev-copilot:jev-verifier` | – | Evidence-based inspection of a concern JEV flagged |

Four skills teach Claude the protocol: `jev-orchestrate` (division of labor and strategy mapping), `jev-review` (completion contract and repair discipline), `jev-context` (two-stage context selection that can never invent paths) and `jev-research` (YouTube research and cited synthesis, below).

## YouTube mass research

<p align="center">
  <img src="assets/jev-youtube-research-workflow.png" alt="How it works: the JEV YouTube research workflow - discover, ingest, screen with JEV, filter and route, deep reasoning, generate research, reuse knowledge" width="100%">
</p>

Point JEV Copilot at one video, a playlist, a channel, a topic, or a text file of URLs and it turns the corpus into **cited, cross-source research**. Transcripts are fetched with yt-dlp (captions only, never media) and chunked by chapter; every video and every chunk is screened by JEV for relevance, content type, technical depth, actionability, novelty, promotional intensity and evidence density. Policy code turns those typed answers into a research value and a route (`deep` / `focused` / `index` / `archive`), suppresses duplicates, and writes an evidence bundle in which every chunk carries a `[videoId@m:ss](url&t=Ns)` citation. Claude then synthesizes consensus, contradictions, unique findings, technical details, parts, procedures, failure modes, best sources and knowledge gaps. Popularity is never treated as quality.

```text
/jev-copilot:youtube-research "3D printer enclosure ventilation" --max 60
/jev-copilot:youtube-analyze https://youtu.be/VIDEO_ID What does the build use?
/jev-copilot:youtube-playlist https://www.youtube.com/playlist?list=PL... Which motor/ESC combos are used?
/jev-copilot:youtube-compare https://youtu.be/A https://youtu.be/B
/jev-copilot:youtube-parts https://youtu.be/A https://youtu.be/B
/jev-copilot:youtube-ask yt-20260928-ab12cd "which firmware did people flash?"
/jev-copilot:youtube-export yt-20260928-ab12cd
```

| Command | MCP tool | Purpose |
|---|---|---|
| `/jev-copilot:youtube-analyze` | `jev_youtube_research` | One video, every chunk screened, cited synthesis |
| `/jev-copilot:youtube-playlist` | `jev_youtube_research` | Playlist or channel corpus against a question |
| `/jev-copilot:youtube-research` | `jev_youtube_research` | Topic search, screening, routing, synthesis |
| `/jev-copilot:youtube-compare` | `jev_youtube_research` | Comparison table across sources |
| `/jev-copilot:youtube-parts` | `jev_youtube_research` | PART / TYPE / MODEL / COUNT / PRICE / TIMESTAMP table |
| `/jev-copilot:youtube-export` | `jev_youtube_export` | Merge the synthesis into `report.md` and `report.json` |
| `/jev-copilot:youtube-ask` | `jev_youtube_ask` | Follow-up question over a job or a named collection |
| - | `jev_youtube_job`, `jev_youtube_bundle`, `jev_youtube_evidence` | Resume jobs, page artifacts, pull one video's evidence |

**What it costs.** Screening is JEV only: about $0.07 for 100 videos (1.5 M transcript tokens). The engine estimates before spending and pauses when the estimate exceeds `budgetUsd` (default $5). Jobs persist per video and resume without re-fetching or re-screening; transcripts are cached across jobs and can be grouped into **collections** for follow-up questions.

**Deep reasoning.** By default (`deep_model = claude-session`) Claude reads the evidence bundle in your session, so no second model or key is needed. For headless CLI runs set `--deep-model <openrouter chat model id>` and the engine performs per-video analysis and synthesis itself.

**Requirements.** `yt-dlp` on the PATH (`python -m pip install -U yt-dlp`). Videos need creator or automatic captions; ASR and frame analysis are not part of this release.

Full guide, pipeline details, storage layout and safety notes: [docs/YOUTUBE_RESEARCH.md](docs/YOUTUBE_RESEARCH.md).

## Install

Requires Node.js 20+ and an [OpenRouter](https://openrouter.ai) API key. No `npm install` is needed to run: the compiled runtime is committed and has zero dependencies.

```bash
claude plugin marketplace add CaptainDigitals/jev-copilot
```

```bash
claude plugin install jev-copilot@jev-copilot
```

Then open `/plugin`, pick **JEV Copilot → Configure**, and paste your OpenRouter key. It is stored in your OS credential store, never in `settings.json`, never in the repository, never in telemetry. Alternatively export `OPENROUTER_API_KEY` in the environment Claude Code runs in.

Check it works:

```text
/jev-copilot:status
```

### Development install

```bash
git clone https://github.com/CaptainDigitals/jev-copilot.git
```

```bash
cd jev-copilot && npm ci && npm test
```

```bash
claude --plugin-dir .
```

### Remove

```bash
claude plugin uninstall jev-copilot@jev-copilot
```

Plugin state (`sessions/`, `cache/`, `telemetry.jsonl`) lives in Claude Code's plugin data directory and is deleted with the plugin unless you pass `--keep-data`.

## Modes

| | `assist` | `enhance` (default) | `strict` |
|---|---|---|---|
| Task profile on prompts | ✓ | ✓ | ✓ |
| Requirement contract | – | ✓ | ✓ |
| Completion review + repair loop | – | ✓ | ✓ tighter thresholds |
| Hard tool rules | ask | ask | deny |
| JEV outage | fail open | fail open | manual review flagged |

Set the mode in the plugin config, with `JEV_COPILOT_MODE`, or per project in `.jev-copilot.json`. Full reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Privacy and safety

- **Data minimization.** JEV receives redacted prompt excerpts, file paths, compact local summaries, short excerpts, changed-file lists and test outcomes. Never whole repositories, never `.env`, keys, certificates or credential paths (see `excludedPaths`).
- **Secret redaction** runs on every outbound state: OpenRouter/OpenAI/Anthropic/GitHub/AWS/Slack/Stripe/Google key formats, JWTs, private key blocks, bearer headers, connection-string passwords, `*_SECRET=`/`*_TOKEN=` assignments and high-entropy strings.
- **Deterministic rules outrank JEV.** A high JEV probability can raise scrutiny; it can never approve a hard-denied action, and read-only operations are never sent to JEV.
- **Telemetry is metadata only**: decision ids, probabilities, latency, tokens, cost, file counts and a hash of the state. No prompt text, no source, no key.
- **Fail open, by design.** No key, an outage, a malformed response or an exhausted budget never breaks Claude Code. Strict mode flags manual review instead of silently passing.
- **Network:** HTTPS to `openrouter.ai` only, 8 s timeout, one retry with backoff, `Retry-After` honoured, 60 KB request guard.

Threat model and details: [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md).

## How decisions are made

JEV answers versioned question bundles; the plugin's policy code makes the decisions. Thresholds live in [config/defaults.json](config/defaults.json) and are starting points for calibration, not truth.

| Bundle | Questions | Policy output |
|---|---|---|
| `task-analysis` | task type (choice), complexity (score 0–3), repo exploration, cross-file scope, tests required, security sensitive, data-change sensitive, ambiguous | strategy: `fast-direct` / `normal` / `deep-reasoning` / `independent-review`; plan, dependency-search, test-evidence, security-review flags; inferred requirements |
| `context-relevance` | per candidate: relevance (score 0–3), needs full content | `full` / `excerpt` / `fallback` bands |
| `completion-review` | implementation complete, tests sufficient, unresolved requirement, likely regression, security concern, needs repo check, regression surface (score), per-requirement satisfied + evidence strength | `pass` / `repair` with deficiencies; verifier escalation |
| `tool-action` | impact (choice), task relevant, requires human confirmation | `ask` / no-op, after deterministic classification |

Contracts: [docs/JEV_DECISION_CONTRACTS.md](docs/JEV_DECISION_CONTRACTS.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Cost

JEV 1.13 on OpenRouter lists at $0.042 per million input tokens and $0 output. A typical session (one task profile, a context ranking, one completion review) costs well under a tenth of a cent. Identical decisions are served from a local content-addressed cache. `session_budget_usd` (default $0.25) stops optional calls when exceeded; safety rules never depend on budget.

## CLI

The same runtime is available outside Claude Code, sharing cache and telemetry with the hooks:

```bash
node dist/src/cli.js status
```

```bash
node dist/src/cli.js analyze "Add OAuth login with callback handling and integration tests"
```

```bash
node dist/src/cli.js context "invoice total rounding"
```

```bash
node dist/src/cli.js assess Bash '{"command":"rm -rf /"}'
```

```bash
node dist/src/cli.js youtube research "FPV drone frame design" --max 50 --collection drones
```

```bash
npm run eval
```

`eval` runs `tests/evals/cases.jsonl` against live JEV and reports classification accuracy; use it to calibrate thresholds after changing the model or question set.

## Repository layout

```text
.claude-plugin/   plugin.json (manifest, userConfig, MCP server) and marketplace.json
hooks/hooks.json  exec-form hooks → dist/src/hooks/runner.js
commands/         /jev-copilot:* commands
skills/           jev-orchestrate, jev-review, jev-context, jev-research
agents/           jev-verifier
config/           defaults.json (thresholds, limits, exclusions)
src/              TypeScript runtime (core, jev, security, policy, state, context, hooks, mcp, youtube, cli)
dist/             committed build output (what Claude Code executes)
tests/            node:test suite, fixtures, evals/cases.jsonl
docs/             PRD, architecture, contracts, security, test plan, roadmap, configuration
```

## Development

```bash
npm ci && npm run typecheck && npm test
```

`npm test` builds first; commit `dist/` with your change (CI fails if it is stale). Validate the manifest with `npm run validate`. Keep the rule that JEV answers questions and code makes decisions: new judgments go in `src/jev/questions/`, new behavior in `src/policy/`, both versioned and covered by tests.

## Roadmap

Phase 0–5 of [docs/ROADMAP.md](docs/ROADMAP.md) shipped in 0.1.0; 0.2.0 adds the YouTube mass research engine (MVP). Next: ASR fallback for caption-less videos, frame analysis, a structured claim ledger with conflict resolution, semantic deduplication, adaptive per-repository thresholds, PR review mode.

## License

MIT © CaptainDigitals. JEV is a product of TypeSafe; OpenRouter and Claude Code are trademarks of their respective owners.
