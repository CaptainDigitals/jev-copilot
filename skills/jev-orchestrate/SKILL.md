---
name: jev-orchestrate
description: Use JEV Copilot as a System-1 decision layer (task routing, complexity, test necessity, ambiguity, risk) while Claude does the System-2 reasoning and implementation. Use when a JEV task profile appears in context, when starting a non-trivial coding task, or when deciding how much planning, exploration or verification a task needs.
---

# JEV orchestration protocol

JEV (TypeSafe, via OpenRouter) answers bounded questions with typed probabilities. It never writes prose or code. You remain responsible for reasoning, planning, repository inspection, implementation, tests, tool use and repair.

## Division of labor

| JEV decides (typed, fast) | Claude decides (open-ended) |
|---|---|
| task type, complexity, cross-file scope | the plan and the design |
| test necessity, security/data sensitivity, ambiguity | what to read, what to change, how to test |
| candidate-file relevance (from a list you supply) | which evidence actually matters |
| requirement coverage, regression and completion likelihood | how to repair and what to tell the user |
| semantic impact of a high-risk tool call | whether to run it, within deterministic safety rules |

## How signals reach you

- **Automatically**: on substantive prompts the `UserPromptSubmit` hook injects a short "JEV task profile" block with a recommended strategy and a requirement contract. When you stop after editing files, the `Stop` hook may run a completion review and return structured deficiencies.
- **Explicitly**: MCP tools on server `jev`: `jev_analyze_task`, `jev_context`, `jev_rank_context`, `jev_review_completion`, `jev_assess_tool_action`, `jev_status`, `jev_session_stats`. Commands: `/jev-copilot:analyze`, `:plan`, `:context`, `:review`, `:status`, `:stats`, `:config-help`.

## Strategy mapping

- `fast-direct`: small, local, low-risk. Make the change, verify it compiles/runs, finish.
- `normal`: read the relevant files, implement, run the existing tests.
- `deep-reasoning`: write a short plan first; search for all call sites and dependents before changing shared code; produce test evidence.
- `independent-review`: everything in deep-reasoning, plus a security or migration review of the change. Delegate uncertain evidence questions to the `jev-copilot:jev-verifier` agent.

## Rules

1. JEV output is evidence, not truth. Confidence below 70% means treat the signal as a hint and reason directly.
2. Explicit user requirements are preserved exactly. Inferred requirements (marked `*` or `INF-`) never override them.
3. When tests are indicated, produce real test evidence before claiming completion. Do not describe tests you did not run.
4. Never ask JEV to invent file paths, code, or explanations. Give it real candidates and real evidence.
5. Deterministic safety rules (recursive deletes at roots, credential access, piping remote content to a shell, permission broadening, destructive database commands) cannot be waived by a JEV score. If a tool call is blocked or asks for confirmation, explain why and offer a safer alternative.
6. Batch independent judgments over the same state; do not loop single questions.
7. If JEV is unavailable (no key, outage, budget exhausted), continue normally and say so only when it affects what the user should trust, for example when strict mode requires manual review.
