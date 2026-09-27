# Architecture

## 1. System overview

```text
Claude Code
  |
  +-- Skills ------------------------------+
  |                                         |
  +-- Commands                              |
  |                                         v
  +-- Hooks ------------------------> Local JEV Runtime
  |                                  |     |      |
  |                                  |     |      +--> Cache / Telemetry
  |                                  |     +---------> Policy Engine
  |                                  +---------------> OpenRouter Client
  |                                                     |
  |                                                     v
  |                                               JEV Decisions API
  |
  +-- Optional MCP tools <------------- Local MCP Server
  |
  +-- Verifier subagent
```

## 2. Why local runtime + optional MCP

Hooks are the correct place for automatic lifecycle behavior. MCP tools are the correct place for explicit, model-invoked operations. Both should call one shared runtime to avoid duplicated policy logic.

## 3. Major modules

### `src/jev/client.ts`

Responsibilities:

- OpenRouter authentication,
- Decisions API requests,
- retries/timeouts,
- model selection,
- response validation,
- sanitized error handling.

### `src/jev/questions.ts`

Central registry for versioned question definitions.

Question IDs are stable so telemetry and evals can compare releases.

### `src/policy/engine.ts`

Converts JEV output into application policy.

Important principle: **JEV answers questions; code makes decisions.**

### `src/review/completion.ts`

Creates completion state and evaluates review judgments.

### `src/telemetry/store.ts`

Local append-only JSONL or compact SQLite store in later releases.

### `src/mcp/server.ts`

Optional stdio MCP interface to shared runtime functions.

## 4. User prompt lifecycle

```text
UserPromptSubmit
  |
  v
Prompt hook script
  |
  +--> cheap deterministic prefilter
          |
          +-- trivial / excluded --> no JEV
          |
          +-- candidate ----------> JEV task analysis
                                     |
                                     v
                                  policy map
                                     |
                                     v
                            context added for Claude
```

The hook should add concise context, not a large report.

Example injected context:

```text
JEV task profile:
- category: feature implementation
- complexity: high
- cross-file scope likely
- tests strongly recommended
- security sensitivity low
Use this as advisory routing information. Verify uncertain details from the repository.
```

## 5. Context selection lifecycle

```text
Task
 |
 +--> deterministic repo discovery
        |
        +--> candidate paths + compact summaries
                 |
                 v
           JEV relevance scoring
                 |
                 v
             policy bands
          /        |       \
       full      excerpt   fallback
```

The plugin must never let JEV invent a file that was not in the candidate set.

## 6. Completion lifecycle

```text
Claude reaches Stop / TaskCompleted
     |
     v
Should review?
  |      \
 no       yes
 |         |
 pass      v
       Build review state
            |
            v
           JEV
            |
            v
       Policy evaluation
       /            \
    pass             repair
     |                 |
 final response     structured feedback
                       |
                       v
                     Claude
```

## 7. Review-state construction

A completion review should contain:

- normalized original request,
- requirement contract,
- changed-file list,
- summarized diff evidence,
- test commands and result summaries,
- known failures,
- unresolved TODOs,
- security-sensitive paths touched.

Do not send unlimited raw diff data. Summarize deterministically and include only evidence needed for each judgment.

## 8. Tool governance lifecycle

```text
PreToolUse
  |
  v
Deterministic classifier
  |
  +-- read-only ------------------------> allow normal flow
  |
  +-- hard blocked ---------------------> deny
  |
  +-- high impact / ambiguous
            |
            v
           JEV
            |
            v
     semantic risk class
            |
            v
        policy engine
       /     |      \
   normal  ask-user  deny
```

JEV must never override a hard deny.

## 9. Model policy

JEV can recommend:

- `fast-direct`
- `normal`
- `deep-reasoning`
- `verification-heavy`

The plugin translates this into instructions to Claude, command/subagent selection, or user guidance. It should not assume an unsupported ability to switch the current session model.

## 10. Data boundaries

Outbound to OpenRouter:

- user prompt excerpts,
- compact repository metadata/excerpts,
- requirement descriptions,
- diff summaries,
- test summaries.

Never outbound by default:

- `.env` contents,
- credentials,
- private keys,
- tokens,
- full repository archive,
- git object database,
- arbitrary binary files.
