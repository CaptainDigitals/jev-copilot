# Roadmap

## Phase 0 — Repository foundation

- plugin skeleton
- TypeScript build
- config schema
- validator CI
- logging/redaction library

Exit: plugin loads with `/jev-copilot:status`.

## Phase 1 — JEV core

- OpenRouter client
- typed decision adapter
- question registry
- response validation
- cache
- connectivity check

Exit: `/jev-copilot:analyze` returns a task profile.

## Phase 2 — Prompt intelligence

- UserPromptSubmit hook
- task strategy mapper
- requirement contract initialization
- concise context injection

Exit: complex tasks receive JEV advisory profile automatically.

## Phase 3 — Completion review

- change tracker
- test evidence collector
- completion question set
- repair feedback
- max-loop enforcement

Exit: intentionally incomplete changes are caught at acceptable recall.

## Phase 4 — Context intelligence

- candidate discovery adapters
- file summarization
- JEV ranking
- relevance cache
- `/jev-copilot:context`

Exit: context recall@K target met on eval set.

## Phase 5 — Tool governance

- deterministic risk classifier
- PreToolUse integration
- JEV semantic supplement
- user confirmation path

Exit: no hard-deny case can be auto-approved.

## Phase 6 — Productization

- marketplace metadata
- docs
- signed releases
- changelog
- migration guide
- broader OS testing

## Phase 7 — Advanced intelligence

- adaptive repo calibration
- CI mode
- PR review mode
- team policies
- cost optimization recommendations

## Phase 6 - YouTube mass research (0.2.0, MVP shipped)

- discovery (video, playlist, channel, search, file, collection)
- sandboxed yt-dlp ingestion (captions only), chapter-aware chunking
- JEV video + chunk screening, research-value routing, deduplication
- cost estimate, budget pause, resumable jobs, cross-job cache, collections
- evidence bundle with citations; Claude-session or headless deep model; reports; follow-up ask

Exit: `/jev-copilot:youtube-research` produces a cited report from a topic.

## Phase 7 - Research depth (planned)

- ASR fallback for caption-less videos (local Whisper), frame/vision analysis
- structured claim ledger with conflict resolution and verification status
- semantic (embedding) deduplication and cross-video merging
- scheduled monitoring of channels and topics, incremental corpus updates
