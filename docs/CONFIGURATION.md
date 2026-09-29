# Configuration reference

Configuration is resolved in this order, later sources winning:

1. `config/defaults.json` (shipped with the plugin)
2. `.jev-copilot.json` in the project root (non-secret keys only)
3. Environment variables, including the `CLAUDE_PLUGIN_OPTION_*` variables Claude Code derives from the plugin's user configuration

The OpenRouter key is read only from `OPENROUTER_API_KEY` or the plugin's sensitive `openrouter_api_key` option. A project file can never set the key or change the endpoint host.

## Plugin user configuration (`/plugin` → JEV Copilot → Configure)

| Option | Type | Default | Effect |
|---|---|---|---|
| `openrouter_api_key` | sensitive string | empty | Bearer token for `https://openrouter.ai/api/alpha/decisions`. Stored in the OS credential store. |
| `mode` | `assist` / `enhance` / `strict` | `enhance` | See modes below. `off` is available via `JEV_COPILOT_MODE=off` or `.jev-copilot.json`. |
| `jev_model` | string | `typesafe/jev-1.13` | Any OpenRouter model id. `~typesafe/jev-latest` tracks new releases; thresholds should be re-validated after a model change. |
| `completion_review_enabled` | boolean | `true` | Run the `Stop` review in `enhance`/`strict`. |
| `tool_governance_enabled` | boolean | `false` | Add JEV semantic review to `high`-impact tool calls and ask on `destructive` ones. Hard rules apply regardless. |
| `session_budget_usd` | number | `0.25` | Optional JEV calls stop when the session's estimated spend exceeds this. `0` disables. |
| `deep_model` | string | `claude-session` | YouTube research deep layer: `claude-session` (Claude synthesizes from the bundle) or an OpenRouter chat model id for headless deep analysis. Env: `JEV_COPILOT_DEEP_MODEL`. |

## Modes

| Behavior | off | assist | enhance | strict |
|---|---|---|---|---|
| Task profile on substantive prompts | – | ✓ | ✓ | ✓ |
| Requirement contract injected | – | – | ✓ | ✓ |
| Completion review on `Stop` | – | – | ✓ (enhance thresholds) | ✓ (strict thresholds) |
| Repair loop cap | – | – | 2 | 2 |
| Hard tool rules | – | ask | ask | deny |
| JEV outage during review | – | – | fail open | flag manual review |
| Governance escalation on JEV outage | – | none | none | ask |

## `.jev-copilot.json`

Any non-secret key from `config/defaults.json` can be overridden per project. Example:

```json
{
  "mode": "strict",
  "thresholds": { "planComplexity": 1.5, "completion": { "strict": { "testsSufficient": 0.8 } } },
  "limits": { "maxRepairLoops": 3, "maxCandidateFiles": 16 },
  "excludedPaths": ["**/fixtures/customers/**"]
}
```

`excludedPaths` replaces the default list when set, so include the defaults you still want.

## YouTube research (`youtubeResearch`)

| Key | Default | Effect |
|---|---|---|
| `ytDlpPath` | `yt-dlp` | Binary name or path (env `JEV_COPILOT_YTDLP_PATH`); `python -m yt_dlp` is tried as fallback |
| `ytDlpTimeoutMs` | 60000 | Per yt-dlp call; playlist and search listing get 3x |
| `maxVideos` | 100 | Discovery cap per job (hard max 500) |
| `maxTranscriptChars` | 400000 | Longer transcripts are truncated before chunking |
| `languages` | `["en"]` | Caption language preference |
| `enableAsrFallback` | false | Reserved; ASR is not bundled in this release |
| `chunk` | 2500 / 3500 / 400 tokens | target / max / min chunk size |
| `chunksPerJevRequest` | 4 | Chunks screened per JEV call |
| `workers` | 4 / 2 / 4 / 2 | Concurrency for metadata, transcripts, JEV, deep model |
| `routing` | see file | Route thresholds (`deep` 0.8, `focused` 0.6, `archive` 0.35) and research-value weights |
| `deepModel` | `claude-session` | See `deep_model` above |
| `deepTimeoutMs` / `deepMaxInputChars` / `deepMaxOutputTokens` | 120000 / 60000 / 2500 | Headless deep model limits |
| `maxDeepChunksPerVideo` / `maxDeepVideos` | 12 / 20 | Evidence per video and default `top` |
| `budgetUsd` | 5 | Pause before screening when the estimate exceeds this |
| `dedupe` | true | Title and shingle-overlap duplicate suppression |

## Thresholds

Defaults are starting points for calibration, not universal truths. Calibrate with `npm run eval` after adding labeled cases to `tests/evals/cases.jsonl`, and record calibrated profiles per `jevModel` and question-set version.

| Key | Default | Used for |
|---|---|---|
| `thresholds.highConfidence` / `mediumConfidence` | 0.90 / 0.70 | Confidence bands for advisory vs. verify vs. ignore |
| `thresholds.planComplexity` | 2.0 | Recommend an explicit plan |
| `thresholds.crossFileScope` | 0.70 | Require dependency search |
| `thresholds.testsRequired` | 0.70 | Require test evidence; adds `INF-TEST` requirement |
| `thresholds.securitySensitive` | 0.60 | Enable security review; adds `INF-SEC`; also used for data-change flag |
| `thresholds.ambiguity` | 0.60 | Ask Claude to state assumptions |
| `thresholds.context.full` / `excerpt` | 2.4 / 1.5 | Context bands |
| `thresholds.completion.enhance.*` | 0.80 / 0.35 / 0.65 / 0.40 / 0.50 | completeness min, unresolved max, regression max, security max, tests min |
| `thresholds.completion.strict.*` | 0.90 / 0.25 / 0.50 / 0.30 / 0.70 | same, tighter |
| `thresholds.tool.*` | ask on destructive; task-relevant < 0.40 asks; human-confirmation > 0.60 asks | Governance |

## Limits and network

| Key | Default |
|---|---|
| `network.timeoutMs` / `maxRetries` / `retryBaseDelayMs` | 8000 / 1 / 400 |
| `limits.minPromptChars` | 40 (shorter prompts are not analyzed) |
| `limits.maxPromptChars` | 12000 |
| `limits.maxCandidateFiles` / `contextBatchSize` | 24 / 12 |
| `limits.maxRepairLoops` | 2 |
| `limits.maxStateChars` | 60000 (hard request size guard) |
| `limits.maxExcerptChars` | 600 |
| `limits.maxChangedFilesInReview` | 40 |
| `cache.enabled` / `ttlSeconds` | true / 86400 |
| `telemetry.enabled` | true (metadata only) |

## Data locations

Research jobs, the transcript cache and collections live under `research/` in the same data directory (see [YOUTUBE_RESEARCH.md](YOUTUBE_RESEARCH.md)).

Runtime state lives in `${CLAUDE_PLUGIN_DATA}` when installed as a plugin, otherwise `~/.claude/jev-copilot/`. Override with `JEV_COPILOT_DATA_DIR`.

- `sessions/<session-id>.json`: task profile, requirement contract, change summary, test evidence, review markers
- `cache/<sha256>.json`: cached decisions
- `telemetry.jsonl`: metadata events
- `debug.log`: only when `JEV_COPILOT_DEBUG=1`; always redacted
