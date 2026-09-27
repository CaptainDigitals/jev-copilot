---
name: jev-context
description: Select repository context with a two-stage design: deterministic candidate discovery (git, grep, imports, recent changes) followed by JEV relevance ranking of that bounded list, so Claude reads the right files without letting the decision model invent paths. Use at the start of multi-file tasks, when a task profile indicates repository exploration or cross-file scope, or when the user runs /jev-copilot:context.
---

# JEV repository context selection

## Two stages, always in this order

1. **Deterministic discovery (you or the runtime).** `jev_context` does this for git repositories: path/keyword matches, uncommitted and recently committed files, exclusion policy applied (`.env`, keys, certificates, credentials, `node_modules`, build output never leave the machine), local summaries with symbol names and a short redacted excerpt. You can also build the list yourself with Grep/Glob, imports and test references; each candidate needs a real path and a one-line summary.
2. **JEV ranking (bounded).** `jev_rank_context` scores each candidate 0–3 for relevance and estimates whether the full file is needed. At most 24 candidates per call; batches of 12 go to JEV per request. Output paths are always a subset of the input.

## Reading policy

- **full** (score ≥ 2.4): read the whole file before changing related code.
- **excerpt** (1.5–2.4): read the summary/excerpt; open fully only if you need it.
- **fallback** (< 1.5): keep in mind; open if dependency evidence points there.

## Rules

- Never let a low score override concrete evidence: an import, a call site, a failing test, or a migration that references a file wins.
- Prefer recall over aggressive elimination for refactors, migrations and security work. Missing a required file costs more than reading one extra.
- Do not send whole repositories or large files; the runtime caps state size and truncates excerpts.
- If discovery finds nothing (not a git repo, no keyword overlap), fall back to your own search; do not ask JEV to guess paths.
- Mention ranking only when it changes what you do; do not paste the whole ranking into every message.
