# YouTube Mass Research Engine

Turns one video, a playlist, a channel, a topic search or a list of URLs into cited, cross-source research knowledge. JEV screens every video and every transcript chunk with typed questions for fractions of a cent; the routed evidence goes to a deep reasoning layer (Claude in your session by default) for synthesis. Popularity is never treated as quality.

```text
inputs ──▶ discover ──▶ ingest (yt-dlp captions, never media) ──▶ chunk
                                                                    │
            report.md ◀── synthesize ◀── deep analysis ◀── route ◀── JEV screening (video + chunks)
            report.json                (claude-session       deep / focused / index / archive
            bundle.md                   or OpenRouter model)  + duplicate suppression
```

## Requirements

- **yt-dlp** on the PATH (or `python -m yt_dlp`). Install or update with `python -m pip install -U yt-dlp`. YouTube changes often; an old yt-dlp is the most common cause of `PROCESSING_FAILED`.
- An OpenRouter key (same as the rest of the plugin).
- Videos need captions (creator or automatic). Videos without captions are reported as `NO_TRANSCRIPT`; ASR fallback is off by default and not bundled.

## Commands and tools

| Command | MCP tool | What it does |
|---|---|---|
| `/jev-copilot:youtube-analyze <url> [question]` | `jev_youtube_research` (task `analyze`) | One video, every chunk screened, cited synthesis |
| `/jev-copilot:youtube-playlist <url> [question]` | `jev_youtube_research` | Playlist or channel corpus against a question |
| `/jev-copilot:youtube-research "<topic>"` | `jev_youtube_research` | YouTube search + screening + routing + synthesis |
| `/jev-copilot:youtube-compare <url> <url>…` | `jev_youtube_research` (task `compare`) | Comparison table across sources |
| `/jev-copilot:youtube-parts <url>…` | `jev_youtube_research` (task `parts`) | PART / TYPE / MODEL / COUNT / PRICE / TIMESTAMP table |
| `/jev-copilot:youtube-export <jobId>` | `jev_youtube_export` | Merge Claude's synthesis into `report.md` / `report.json` |
| `/jev-copilot:youtube-ask <jobId\|collection> "<q>"` | `jev_youtube_ask` | Follow-up question over stored transcripts |
| – | `jev_youtube_job` | List, inspect, resume jobs (also over-budget continuation) |
| – | `jev_youtube_bundle` | Page through `bundle.md`, `report.md`, `report.json`, `synthesis.md` |
| – | `jev_youtube_evidence` | Cited chunks for one video of a job |

The `jev-research` skill tells Claude how to run the engine, read the bundle and write the synthesis (consensus, contradictions, unique findings, technical details, tools, procedures, failure modes, best sources, gaps, follow-ups; every claim cited as `[videoId@m:ss](url&t=Ns)`).

### CLI

```bash
node dist/src/cli.js youtube analyze https://youtu.be/VIDEO_ID --question "What does the build use?"
```

```bash
node dist/src/cli.js youtube research "FPV drone frame design" --max 50 --mode standard --collection drones
```

```bash
node dist/src/cli.js youtube playlist "https://www.youtube.com/playlist?list=PL..." --question "Which motor/ESC combinations are used?" --top 10
```

```bash
node dist/src/cli.js youtube parts https://youtu.be/A https://youtu.be/B
```

```bash
node dist/src/cli.js youtube status
```

```bash
node dist/src/cli.js youtube resume yt-20260928-ab12cd --yes
```

```bash
node dist/src/cli.js youtube export yt-20260928-ab12cd --synthesis my-synthesis.md --out report.md
```

```bash
node dist/src/cli.js youtube ask drones "which ESC firmware did people flash?"
```

Options: `--mode fast|standard|deep|audit`, `--task research|analyze|compare|parts|steps`, `--max N`, `--top N`, `--all`, `--no-dedupe`, `--budget USD`, `--deep-model <id|claude-session>`, `--collection name`, `--question "..."`, `--yes`. Exit code 3 means the job paused over budget.

Headless runs (`--deep-model anthropic/claude-sonnet-4.5` or any OpenRouter chat model id) perform per-video deep analysis and the synthesis inside the CLI via `https://openrouter.ai/api/v1/chat/completions`. Inside Claude Code the default `claude-session` needs no second model: Claude reads the bundle.

## Pipeline

| Stage | What happens | JEV calls |
|---|---|---|
| DISCOVERING | URLs, ids, playlists, channels (`yt-dlp --flat-playlist`), searches (`ytsearchN:`), `.txt` files and collections expand to an ordered, de-duplicated id list capped by `maxVideos` | 0 |
| INGESTING | Metadata (`yt-dlp -J`) and captions (json3; creator captions first, then automatic) per video with a cross-job cache; private/deleted/unavailable/no-caption videos are recorded, never fatal | 0 |
| CHUNKING | Chapter-aware, sentence-aware chunks of ~2 500 tokens with `videoId:0000` ids and timestamps | 0 |
| SCREENING | Video-level bundle (relevance 0–4, content type, technical depth 0–3, actionability, novelty, promotional intensity, evidence density 0–2, deep recommended) then chunk-level bundle in batches of 4 (relevant, importance, steps, hardware, software, code, measurements, design decision, failure) | 1 + ⌈chunks/4⌉ per video |
| DEDUPLICATING | Same channel + same normalized title, or ≥60 % 8-word shingle overlap → duplicate archived, canonical kept | 0 |
| ANALYZING | Only when a headless deep model is set: routed chunks per candidate video → per-video analysis | 0 (chat model) |
| SYNTHESIZING | `bundle.md` (screening table + routed evidence with citations), `report.md`, `report.json`; synthesis merged when available | 0 |

Research value is computed by policy code, not by JEV:

```text
value = 0.30·relevance/4 + 0.20·depth/3 + 0.20·actionability/2 + 0.15·novelty/2 + 0.15·evidence/2 − 0.20·promotional/2 − 0.5·duplicate
route = deep (≥0.80, or JEV recommends deep and ≥0.60) · focused (≥0.60) · index (≥0.35) · archive
```

Weights and thresholds live under `youtubeResearch.routing` in `config/defaults.json` and can be overridden per project in `.jev-copilot.json`.

## Cost and budget

Before screening, the engine estimates JEV cost from transcript tokens (JEV 1.13: $0.042 per million input tokens) and, for headless deep models, a conservative input estimate. If the estimate exceeds `budgetUsd` (default $5) the job pauses in state `CHUNKING` with nothing spent on JEV; continue with `jev_youtube_job { jobId, resume: true, confirmOverBudget: true }` or `youtube resume <id> --yes`. Typical: 100 videos ≈ 1.5 M transcript tokens ≈ $0.07 of JEV screening.

## Storage

Under the plugin data directory (`CLAUDE_PLUGIN_DATA`, or `JEV_COPILOT_DATA_DIR`):

```text
research/jobs/<jobId>/job.json                 state, per-video records, metrics (resumable)
research/jobs/<jobId>/videos/<id>.chunks.json  chunks
research/jobs/<jobId>/videos/<id>.screening.json
research/jobs/<jobId>/videos/<id>.deep.md      headless deep analysis (optional)
research/jobs/<jobId>/{bundle.md,report.md,report.json,synthesis.md}
research/cache/videos/<id>/{meta,transcript}.json   shared across jobs
research/collections/<name>.json               video and job ids per collection
```

Transcripts are stored locally only. Nothing is uploaded except redacted screening state to OpenRouter (JEV) and, for headless deep models, the routed evidence to the chosen chat model.

## Safety

- yt-dlp runs through `execFile` (no shell) with a fixed option allowlist, `--ignore-config`, `--skip-download`, and the user value always last after `--`. Only YouTube hosts are accepted; free text becomes a sanitized `ytsearchN:` query that can never start with a dash. Media is never downloaded; captions go to a private temp directory with an 8 MB cap.
- Transcript text is data. The screening questions instruct JEV to treat video text as data; the `jev-research` skill instructs Claude the same way.
- Secret redaction applies to everything sent to JEV or a deep model.
- Per-video failures never fail a job; each is recorded with a redacted reason. Rate limiting (HTTP 429) is classified and surfaced.

## Limits (MVP)

Not included yet: ASR transcription for caption-less videos, frame/vision analysis, Whisper integration, structured claim ledger with conflict resolution, semantic (embedding) deduplication, scheduled monitoring. These are tracked in the roadmap.
