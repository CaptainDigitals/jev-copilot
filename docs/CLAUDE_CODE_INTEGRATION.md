# Claude Code Integration Specification

## 1. Plugin components

Claude Code plugins can bundle skills, agents, hooks, MCP servers and commands. JEV Copilot should use each only where it adds value.

## 2. Plugin manifest

Use `.claude-plugin/plugin.json` for:

- plugin metadata,
- user config,
- MCP server registration,
- optional explicit component paths.

Prefer standard directories so the manifest remains small.

## 3. Skills

### `skills/jev-orchestrate/SKILL.md`

Purpose:

- teach Claude the System-1/System-2 division,
- explain when JEV judgments are useful,
- prohibit asking JEV for prose/code,
- explain confidence-aware fallback,
- tell Claude to preserve explicit user requirements.

### `skills/jev-review/SKILL.md`

Purpose:

- use structured requirement contract,
- invoke completion review,
- interpret deficiencies,
- repair only failed areas when possible.

### `skills/jev-context/SKILL.md`

Purpose:

- build deterministic candidate list,
- use JEV to rank it,
- avoid fabricated paths,
- preserve fallback candidates.

## 4. Commands

Recommended command namespace:

- `/jev-copilot:status`
- `/jev-copilot:analyze`
- `/jev-copilot:context`
- `/jev-copilot:review`
- `/jev-copilot:stats`
- `/jev-copilot:config-help`

Command files should be concise and route to skills or MCP tools.

## 5. Hooks

### UserPromptSubmit

Use for:

- task-profile generation,
- requirement contract initialization,
- concise context injection.

Guard conditions:

- ignore empty prompts,
- ignore very short conversational prompts,
- allow exclusions,
- enforce timeout.

### PreToolUse

Use only for configured high-impact tools/actions.

Do not call JEV for ordinary reads.

### PostToolUse / PostToolBatch

Use to update local change-state and test evidence without necessarily calling JEV.

### TaskCompleted / Stop

Use for completion verification.

Avoid duplicate review by session/turn state marker.

### SessionStart

Use to initialize telemetry/cache state and optionally validate configuration.

### SessionEnd

Flush local telemetry.

## 6. Hook output philosophy

Hooks should return the smallest useful amount of context.

Good:

```text
JEV profile: complex multi-file feature; tests strongly indicated; auth sensitivity low.
```

Bad:

A multi-page analysis copied into every turn.

## 7. MCP tools

The optional local MCP server gives Claude explicit access to shared runtime operations.

Suggested schemas:

### `jev_analyze_task`

Input:

```json
{ "request": "...", "repoSummary": { } }
```

Output:

```json
{ "taskType": "feature", "complexity": 2.6, "testsRequired": 0.96 }
```

### `jev_rank_context`

Input is a bounded candidate list.

### `jev_review_completion`

Input is the requirement contract + implementation evidence.

### `jev_assess_tool_action`

Reserved for high-impact actions.

### `jev_session_stats`

Returns local telemetry only.

## 8. Subagent

`agents/jev-verifier.md` should be used when JEV identifies uncertainty that requires actual reasoning, source inspection or test interpretation.

Examples:

- JEV says security concern probability is medium,
- JEV says requirement evidence is ambiguous,
- JEV says regression risk is high but cannot explain why.

The verifier subagent then performs generative analysis using repository evidence.

## 9. Model handling

Claude Code's current active model remains authoritative.

The plugin can:

- recommend deeper reasoning,
- invoke a specifically configured subagent model when supported,
- configure command model preferences where supported.

The plugin should not depend on directly switching the active model from arbitrary hook code.

## 10. Development and validation

During development:

```bash
npm install
npm run build
claude plugin validate . --strict
claude --plugin-dir .
```

A release pipeline should validate the plugin on all supported operating systems.
