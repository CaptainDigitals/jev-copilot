# JEV Copilot for Claude Code
## Comprehensive Product Requirements Document

**Working product name:** JEV Copilot  
**Product type:** Claude Code plugin  
**Primary runtime:** TypeScript / Node.js  
**Decision model:** TypeSafe JEV via OpenRouter Decisions API  
**Primary generative model:** Claude Code's active Claude model (for example Fable-class or Opus-class models)  
**Status:** Build specification  

---

## 1. Executive summary

JEV Copilot is a Claude Code plugin that adds a fast, structured decision layer around Claude's normal coding workflow. It uses TypeSafe JEV through OpenRouter to make bounded semantic judgments such as task classification, complexity scoring, repository-context relevance, tool-risk assessment, requirement coverage, regression-risk estimation, security-risk screening, and completion verification.

The plugin does **not** attempt to replace Claude's reasoning or generation. JEV is used as a System-1 control layer. Claude remains responsible for planning, implementation, explanation, code generation, test creation, debugging, tool execution, and repair.

The central product thesis is:

> Use JEV for narrow semantic decisions that can be expressed as typed choices, yes/no probabilities, or ordered scores; use Claude for open-ended reasoning and generation.

The product should improve four dimensions of Claude Code work:

1. **Efficiency** — reduce unnecessary context loading, excessive exploration and avoidable heavyweight reasoning.
2. **Reliability** — independently check requirement coverage, likely regressions and completion claims.
3. **Control** — introduce policy-driven behavior for risky actions, ambiguous tasks and low-confidence decisions.
4. **Observability** — show what JEV decided, confidence levels, cost, latency, overrides and quality outcomes.

---

## 2. Problem statement

Claude Code is excellent at broad reasoning and code generation, but many agentic decisions are repetitive and bounded:

- Is this task a bug fix, refactor, feature, migration, security change or documentation task?
- Which of twenty candidate files are actually relevant?
- Does a proposed tool action look destructive?
- Are tests required for this change?
- Did the implementation cover every stated requirement?
- Is there an obvious regression risk?
- Is Claude declaring completion despite missing work?

Using a full reasoning model for each of these small decisions can be unnecessarily expensive and can add latency. Hard-coded rules alone are brittle because the decisions are semantic. A fast structured decision model is a better fit.

JEV provides typed decision primitives rather than free-form text. The plugin can therefore convert semantic judgments into deterministic program flow.

---

## 3. Goals

### 3.1 Primary goals

- Integrate JEV with Claude Code using OpenRouter as the inference provider.
- Make JEV useful automatically without requiring the user to invoke it for every operation.
- Preserve Claude as the primary reasoning/generation engine.
- Add confidence-aware routing and verification.
- Reduce irrelevant context sent to Claude where safe to do so.
- Add an independent completion-verification layer.
- Add optional high-impact tool-call governance.
- Provide transparent session-level telemetry.
- Package skills, commands, hooks, agents and optional MCP tools as one installable Claude Code plugin.
- Keep all important behavior configurable and auditable.

### 3.2 Secondary goals

- Support multiple policy profiles: `assist`, `enhance`, and `strict`.
- Allow per-project overrides.
- Support pinned and rolling JEV model selection.
- Provide an evaluation harness for threshold calibration.
- Be extensible to other System-1 decision models later.

### 3.3 Non-goals

- Replacing Claude with JEV.
- Asking JEV to generate code, prose or explanations.
- Sending every single tool call to JEV.
- Auto-approving destructive actions solely because JEV gave a high probability.
- Automatically changing Claude models through undocumented or unsupported APIs.
- Treating JEV confidence as a guarantee of correctness.
- Uploading an entire repository to JEV indiscriminately.

---

## 4. Target users

### 4.1 Primary user

A software developer using Claude Code for iterative repository work who wants better task routing, tighter context selection, independent review, lower inference waste and more reliable completion behavior.

### 4.2 Team / enterprise user

A development organization that wants a standardized Claude Code policy layer for:

- repository context handling,
- risky command review,
- completion quality gates,
- security-sensitive development workflows,
- AI-assisted coding auditability.

---

## 5. Product positioning

JEV Copilot should be positioned as an **intelligence control plane for Claude Code**, not as a competing coding model.

Conceptual model:

```text
User Intent
   |
   v
JEV System-1 Decisions
   |  task type / risk / context / requirements / strategy
   v
Claude System-2 Work
   |  reason / plan / edit / test / explain
   v
JEV Verification
   |  coverage / regression / security / completion
   +---------- pass ----------> final response
   |
   +---------- repair --------> Claude revision loop
```

---

## 6. Product modes

### 6.1 Off

JEV integration disabled. Claude Code behaves normally.

### 6.2 Assist

JEV provides advisory decisions only.

Features:

- task classification,
- complexity estimation,
- context relevance suggestions,
- optional manual `/jev:review`.

No blocking behavior.

### 6.3 Enhance — default

JEV participates automatically at selected lifecycle points.

Features:

- prompt analysis,
- repository-context ranking,
- requirement extraction/checklist generation,
- risk-aware strategy recommendations,
- completion verification,
- optional review after materially significant edits.

JEV may request Claude re-check work, but it does not hard-block low-risk completion by default.

### 6.4 Strict

Designed for production repositories and higher assurance.

Adds:

- completion thresholds,
- requirement coverage gates,
- security-risk escalation,
- high-impact tool-action review,
- required test evidence where the task semantics indicate tests should exist,
- fail-closed behavior for selected policy categories.

Strict mode must remain configurable because universal thresholds are not appropriate across repositories.

---

## 7. Core user stories

### 7.1 Task analysis

**As a developer**, when I submit a complex coding request, I want JEV to classify the task and estimate complexity so Claude starts with an appropriate strategy.

Acceptance criteria:

- analysis completes without generating prose from JEV,
- results are structured,
- analysis latency target is below the configured budget,
- low-confidence results are advisory only.

### 7.2 Context selection

**As a developer**, I want the plugin to rank candidate repository files for semantic relevance so Claude can focus on the most likely useful files.

Acceptance criteria:

- deterministic repository search produces candidate files first,
- JEV only judges a bounded candidate set,
- the plugin never lets JEV invent file paths,
- excluded files remain recoverable if Claude later needs them.

### 7.3 Requirement coverage

**As a developer**, I want my original requirements converted into a reusable completion contract so the final implementation can be checked against what I actually asked for.

Acceptance criteria:

- explicit requirements are preserved,
- inferred requirements are separately labeled,
- coverage is checked after implementation,
- low-confidence coverage results trigger review rather than silent failure.

### 7.4 Completion verification

**As a developer**, I want the plugin to challenge premature completion claims.

Acceptance criteria:

- JEV receives the user request, requirement checklist, changed-file summary, test evidence and concise diff metadata,
- it returns typed judgments,
- failed thresholds produce actionable structured feedback to Claude,
- repair loops are capped.

### 7.5 Tool governance

**As a developer**, I want destructive or high-impact tool calls to receive additional semantic scrutiny without slowing down routine reads.

Acceptance criteria:

- read-only operations bypass JEV by default,
- known destructive classes are first detected by deterministic rules,
- JEV supplements rather than replaces hard safety rules,
- destructive commands are never auto-approved only from a JEV score.

### 7.6 Telemetry

**As a developer**, I want to see whether JEV is actually improving my workflow.

Session metrics:

- number of JEV calls,
- average latency,
- estimated JEV token/cost consumption,
- number of advisory decisions,
- number of completion repairs,
- number of tool-review escalations,
- number of low-confidence fallbacks,
- context candidates evaluated and retained.

---

## 8. Functional requirements

### FR-001 Plugin packaging

The product SHALL be distributed as a Claude Code plugin with:

- `.claude-plugin/plugin.json`,
- skills,
- commands,
- hooks,
- one or more subagents where useful,
- optional MCP server,
- local TypeScript runtime,
- config and evals.

### FR-002 Secure OpenRouter configuration

The plugin SHALL accept an OpenRouter API key through a sensitive Claude Code user-config field or environment variable.

The plugin SHALL NOT write the API key to logs, telemetry files, prompts, crash dumps or generated reports.

### FR-003 Pinned default model

The default JEV model SHALL be configurable and SHOULD default to a pinned model identifier such as:

`typesafe/jev-1.13`

The user MAY select a rolling alias such as:

`~typesafe/jev-latest`

The UI SHALL warn that rolling aliases may alter behavior and require threshold revalidation.

### FR-004 JEV primitives

The runtime SHALL support:

- `noul` for yes/no probability,
- `choice` for a bounded set of alternatives,
- `score` for ordered level judgments.

The runtime SHALL preserve returned probability distributions and confidence where supplied.

### FR-005 Prompt analyzer

On selected user prompts, the plugin SHALL calculate a task profile containing at least:

- task category,
- complexity,
- ambiguity,
- likely cross-file scope,
- test necessity,
- security sensitivity,
- migration/data-change sensitivity,
- need for repository exploration.

### FR-006 Strategy policy

The plugin SHALL map JEV outputs to code-owned strategy decisions.

Example mapping:

```text
if complexity >= threshold -> recommend explicit plan
if cross-file probability >= threshold -> require repository-wide dependency search
if test necessity >= threshold -> require test evidence before completion
if security sensitivity >= threshold -> enable security review
```

Thresholds MUST be configurable.

### FR-007 Candidate context generation

Context selection SHALL use a two-stage design:

1. deterministic candidate discovery,
2. JEV semantic ranking.

Candidate discovery MAY include:

- git diff,
- ripgrep,
- import graph,
- symbol references,
- filename/path matching,
- language server references,
- recently changed files.

JEV SHALL not search the filesystem itself.

### FR-008 Context ranking

For each candidate file, JEV SHALL return a relevance score or bounded choice.

Policy SHALL support:

- include full file,
- include relevant excerpt,
- deprioritize,
- retain as fallback.

### FR-009 Requirement contract

The plugin SHALL create a structured requirement contract from the user's prompt and any explicit acceptance criteria.

Each requirement SHALL include:

- stable ID,
- source type: `explicit` or `inferred`,
- description,
- verification strategy,
- severity if omitted,
- status.

Inferred requirements SHALL never silently override explicit requirements.

### FR-010 Edit/change tracking

The plugin SHALL maintain a concise session change summary including:

- files created,
- files modified,
- files deleted,
- test files changed,
- migration files changed,
- config/security-sensitive files changed.

### FR-011 Completion review

Before completion in `enhance` or `strict` mode, the plugin SHALL optionally run a review containing:

- requirement coverage,
- implementation completeness,
- test sufficiency,
- likely regression risk,
- likely security risk,
- unresolved ambiguity,
- documentation/update needs where applicable.

### FR-012 Repair loop

If review fails policy thresholds:

1. structured deficiencies SHALL be returned to Claude,
2. Claude SHALL receive an opportunity to repair,
3. the plugin SHALL rerun only the failed or stale checks,
4. the loop SHALL stop after a configurable maximum.

Default repair loop cap: 2.

### FR-013 Tool-risk review

The plugin MAY inspect `PreToolUse` and permission events.

It SHALL distinguish:

- low-impact read,
- ordinary write,
- broad repository mutation,
- destructive filesystem action,
- credential/security action,
- deployment/infrastructure action.

Deterministic safety policies take precedence over JEV.

### FR-014 Commands

The plugin SHALL expose commands conceptually equivalent to:

- `/jev:status`
- `/jev:analyze`
- `/jev:plan`
- `/jev:context`
- `/jev:review`
- `/jev:stats`
- `/jev:config-help`

Commands may be implemented as skills or explicit commands depending on Claude Code's current plugin API.

### FR-015 Skills

At minimum:

- `jev-orchestrate` — collaboration protocol and automatic usage guidance,
- `jev-review` — completion and quality review workflow,
- `jev-context` — repository context selection workflow.

### FR-016 Subagent

The plugin SHOULD include a focused verifier subagent definition that Claude can delegate to when JEV identifies uncertainty requiring generative reasoning.

The subagent SHALL not duplicate JEV's bounded judgments; it exists for deeper inspection.

### FR-017 MCP interface

The plugin SHOULD expose a local stdio MCP server with tools such as:

- `jev_analyze_task`
- `jev_rank_context`
- `jev_review_completion`
- `jev_assess_tool_action`
- `jev_session_stats`

MCP calls SHALL invoke the local runtime, which then calls OpenRouter.

### FR-018 Local caching

The runtime SHOULD cache identical JEV judgments for the same:

- model,
- state hash,
- questions hash,
- policy version.

Cache entries SHALL be invalidated when relevant state changes.

### FR-019 Fail-open / fail-closed policy

Default behavior:

- network/API failure -> fail open for advisory features,
- failure during strict completion gate -> configurable, default to `manual-review-required`,
- deterministic security policy -> fail closed when configured.

### FR-020 Offline behavior

If no OpenRouter key is configured or the service is unavailable:

- plugin SHALL not break Claude Code,
- skills SHALL explain degraded mode,
- normal Claude workflow SHALL continue unless strict policy explicitly requires JEV.

---

## 9. JEV decision domains

The plugin SHALL define separate schemas instead of one generic "is this good?" question.

### 9.1 Task router

Outputs:

- task type choice,
- repository exploration probability,
- complexity score,
- cross-file probability.

### 9.2 Test necessity judge

Outputs probability that the task requires test evidence before completion.

### 9.3 Security sensitivity judge

Outputs probability that the change touches authentication, authorization, secrets, cryptography, input validation, permissions, security policy, networking trust boundaries or dependency supply chain concerns.

### 9.4 Context relevance judge

Scores candidate files relative to the task.

### 9.5 Requirement coverage judge

Evaluates whether evidence in the implementation satisfies each individual requirement.

### 9.6 Regression judge

Scores likely regression exposure on an ordered rubric.

### 9.7 Tool-risk judge

Classifies semantic impact of a proposed action after deterministic parsing.

### 9.8 Completion judge

Evaluates whether there is enough evidence to allow Claude to claim completion.

---

## 10. Confidence policy

JEV probabilities/confidence SHALL never be interpreted as guaranteed correctness.

Default policy bands for initial development only:

```text
HIGH        >= 0.90
MEDIUM      0.70 - 0.8999
LOW         < 0.70
```

These are product defaults, not universal truth thresholds.

### High confidence

May inform automatic low-risk strategy choices.

### Medium confidence

Claude SHOULD independently verify before acting.

### Low confidence

JEV result SHOULD be advisory or ignored, and Claude SHOULD reason directly.

Thresholds SHALL be calibrated using the evaluation harness on real repository tasks before strict-mode production use.

---

## 11. Claude model integration

The plugin SHALL remain compatible with whichever Claude model is active in Claude Code.

JEV MAY recommend a strategy class such as:

- `fast-direct`,
- `normal`,
- `deep-reasoning`,
- `independent-review`.

The plugin SHALL NOT depend on undocumented model-switch APIs.

If supported by current Claude Code command/agent configuration, selected plugin commands or subagents MAY name a specific model. Otherwise the user retains model control.

The product SHOULD expose model recommendations rather than claiming it can always change models automatically.

---

## 12. User experience

### 12.1 Minimal default output

Routine JEV calls should not spam the terminal.

Default visible indicators:

```text
JEV: feature / complex / tests recommended / confidence 93%
```

### 12.2 Detailed status

`/jev:status` should display:

```text
JEV Copilot
Mode: enhance
Provider: OpenRouter
Model: typesafe/jev-1.13
API: connected
Task type: feature implementation
Complexity: high
Security sensitivity: low
Test necessity: high
Completion review: enabled
Tool governance: high-impact only
```

### 12.3 Review output

```text
JEV Completion Review
Requirements: 7/7 likely satisfied
Implementation completeness: 0.95
Test sufficiency: 0.91
Regression risk: low
Security risk: low
Unresolved ambiguity: 0.08
Decision: pass
```

When failing:

```text
Decision: repair required
- RQ-04: migration behavior not evidenced
- TEST-01: no integration evidence for changed callback behavior
```

---

## 13. Configuration

Required user-config fields:

- `openrouter_api_key` — sensitive string
- `mode` — assist/enhance/strict
- `jev_model` — pinned or rolling alias
- `completion_review_enabled`
- `tool_governance_enabled`

Recommended advanced config:

- confidence thresholds,
- completion pass thresholds,
- max repair loops,
- maximum candidate files,
- maximum bytes/tokens per JEV state,
- telemetry enabled,
- telemetry path,
- cache TTL,
- allow rolling model alias,
- strict API failure policy.

---

## 14. Performance requirements

### Targets

- JEV call overhead should generally stay below the latency saved by the decision it enables.
- Prompt analysis should be batched into one JEV request where questions are independent.
- Completion review should batch independent judgments where possible.
- Context ranking should process bounded candidate groups, not entire repositories.

### Budgets

Default limits:

- prompt-analysis state: <= 8K tokens,
- context-ranking batch: <= 24 candidate summaries,
- completion-review state: <= 16K tokens,
- absolute request guard: below model context limit with safety margin.

---

## 15. Cost controls

- Record JEV input token estimates where available.
- Maintain per-session estimated cost.
- Allow a session budget.
- Stop optional JEV calls after budget exhaustion.
- Never skip deterministic security protections due to budget.
- Prefer one request with several independent questions rather than repeated single-question calls.

---

## 16. Privacy and repository data minimization

The plugin SHALL minimize outbound code/context.

Rules:

1. Do not upload full repositories.
2. Redact likely secrets before JEV submission.
3. Prefer metadata and excerpts over full files.
4. Exclude configured paths such as `.env`, key stores, certificate directories and credential caches.
5. Never send the OpenRouter key as model state.
6. Offer an outbound-preview debug mode that shows redacted state before transmission.

---

## 17. Security requirements

- API key stored through Claude Code sensitive configuration or environment variable.
- No shell interpolation of untrusted prompt text into executable commands.
- Hook scripts parse JSON via Node, not ad-hoc shell where possible.
- Validate all hook input.
- Apply timeouts to network calls.
- Apply maximum request sizes.
- Sanitize logs.
- Separate decision advisory from deterministic deny rules.
- Use explicit allowlists for tool-governance categories.
- No remote code loading.
- Dependency versions pinned for release builds.

---

## 18. Observability

Local session telemetry schema:

```json
{
  "sessionId": "...",
  "mode": "enhance",
  "jevModel": "typesafe/jev-1.13",
  "calls": 14,
  "failures": 0,
  "avgLatencyMs": 86,
  "estimatedInputTokens": 24400,
  "estimatedCostUsd": 0.0010248,
  "completionRepairs": 1,
  "toolEscalations": 0,
  "lowConfidenceFallbacks": 2,
  "contextCandidates": 38,
  "contextSelected": 11
}
```

Telemetry SHALL contain no raw API key and SHOULD avoid raw source code by default.

---

## 19. Failure handling

### OpenRouter timeout

- retry once with bounded exponential backoff,
- then apply configured failure policy.

### Rate limit

- respect retry guidance when present,
- disable optional JEV calls temporarily,
- keep Claude functional.

### Invalid JEV response

- schema validation failure,
- record sanitized error,
- do not infer missing values,
- fall back to Claude/deterministic policy.

### Hook failure

Hooks SHOULD return safe no-op behavior rather than crash Claude Code, except intentionally blocking strict safety gates.

---

## 20. Evaluation framework

Before enabling strict mode by default for any repository, collect labeled tasks.

Suggested initial dataset:

- 25 simple edits,
- 25 feature requests,
- 20 multi-file refactors,
- 15 test-related tasks,
- 15 migration/config changes,
- 15 security-sensitive changes,
- 15 intentionally incomplete implementations,
- 10 destructive-tool scenarios.

Measure:

- task classification accuracy,
- test-necessity precision/recall,
- context-relevance recall at K,
- incomplete-work detection rate,
- false repair rate,
- tool-risk false positive/negative rate,
- latency,
- JEV cost,
- total Claude token change,
- task completion quality.

---

## 21. Acceptance criteria for MVP

The MVP is complete when:

1. Plugin validates under current Claude Code plugin validation.
2. User can configure an OpenRouter key securely.
3. `/jev:status` reports connectivity and mode.
4. Prompt analysis calls JEV and returns validated typed output.
5. A context-ranking workflow can rank deterministic candidate files.
6. Completion review can assess a structured requirement contract.
7. Failed review produces structured repair feedback.
8. JEV service failure does not crash normal Claude usage.
9. Local telemetry records latency/cost without secrets.
10. Unit and integration tests pass.
11. README documents development install and removal.
12. The plugin has an evaluation dataset and threshold-tuning workflow.

---

## 22. Post-MVP capabilities

- semantic diff triage,
- per-language decision profiles,
- adaptive thresholds per repository,
- GitHub PR review mode,
- CI headless evaluation mode,
- team policy bundles,
- repository-specific trust zones,
- cost-aware Claude strategy recommendations,
- JEV-powered permission auto-triage for low-risk actions,
- plugin marketplace packaging,
- signed releases,
- hosted team telemetry (opt-in only),
- alternate System-1 provider adapters.

---

## 23. Product success metrics

Technical:

- >99% plugin runtime stability,
- <1% malformed JEV response rate after SDK validation,
- <5% false repair rate after calibration,
- measurable reduction in irrelevant context loading,
- no secret leakage in automated tests.

User value:

- fewer premature completion claims,
- fewer unnecessary Claude exploration steps,
- lower total inference cost on repetitive bounded judgments,
- improved user trust because decisions are inspectable.

---

## 24. Recommended build strategy

Build in this order:

1. plugin shell + configuration,
2. OpenRouter/JEV client,
3. typed decision schemas,
4. manual `/jev:analyze`,
5. prompt-analysis hook,
6. completion contract + `/jev:review`,
7. automatic completion hook,
8. context ranking,
9. telemetry/cache,
10. high-impact tool governance,
11. evaluation calibration,
12. marketplace packaging.

This sequence maximizes testability and prevents the most sensitive feature — tool gating — from shipping before the decision layer has been calibrated.
