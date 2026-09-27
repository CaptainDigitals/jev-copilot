---
description: Discover and rank repository context for a task with JEV.
argument-hint: [task text; defaults to the current task]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_context, mcp__plugin_jev-copilot_jev__jev_rank_context, Grep, Glob, Read
---

Follow the `jev-context` skill.

Call `jev_context` with `task` = `$ARGUMENTS` (or the current task) and `cwd` = the project directory. It discovers candidates deterministically (git-tracked files matched by path/keyword, uncommitted and recent changes, exclusion policy applied) and asks JEV to rank only those.

If discovery returns few or no candidates, build your own candidate list with Grep/Glob (real paths only, with a one-line summary each, at most 24) and call `jev_rank_context` instead.

Present the `rendered` block: files to read fully, files to skim, and fallback files. Then proceed using that ordering. A fallback ranking never proves a file is irrelevant: if imports, call sites or tests point at a file, read it regardless of its score.
