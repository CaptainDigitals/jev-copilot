---
description: Build a JEV-informed implementation plan for a task before editing.
argument-hint: [task text; defaults to the current task]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_analyze_task, mcp__plugin_jev-copilot_jev__jev_context, Read, Grep, Glob
---

Follow the `jev-orchestrate` skill.

1. Call `jev_analyze_task` for `$ARGUMENTS` (or the current task) with `cwd` set to the project directory.
2. If the profile recommends repository exploration or cross-file scope, call `jev_context` with the same task and `cwd` to get a ranked list of real candidate files; read the "read fully" set and skim the excerpts.
3. Write a plan with these sections:
   - **Requirement contract**: the explicit requirements verbatim, then inferred ones marked `*`.
   - **Strategy**: the recommended strategy (`fast-direct`, `normal`, `deep-reasoning`, `independent-review`) and what it changes about how you will work.
   - **Files**: the files you expect to touch, taken only from real repository evidence.
   - **Verification**: the test evidence you will produce, and whether a security review or migration/rollback plan is needed.
   - **Open questions**: only if JEV flagged ambiguity above threshold or you found a genuine conflict.
4. Stop and present the plan. Do not start editing until the user confirms, unless they asked you to proceed.
