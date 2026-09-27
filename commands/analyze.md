---
description: Analyze a task with JEV and show the typed task profile and strategy.
argument-hint: [task text; defaults to the current task]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_analyze_task
---

Call `jev_analyze_task` with `request` set to `$ARGUMENTS`, or to the user's current task when no argument is given, and `cwd` set to the project directory.

Report the `rendered` block from the result verbatim, then list the requirement contract (explicit items first, inferred items marked with `*`).

These are System-1 decision signals: task type, complexity, cross-file scope, test necessity, security and data sensitivity, ambiguity, and the code-owned strategy recommendation. They are routing evidence, not implementation instructions. Do not act on any signal that contradicts an explicit user requirement, and verify uncertain repository facts directly.
