---
description: Research every video of a YouTube playlist or channel against a question.
argument-hint: <playlist or channel url> [research question] [--max N]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_research, mcp__plugin_jev-copilot_jev__jev_youtube_job, mcp__plugin_jev-copilot_jev__jev_youtube_bundle, mcp__plugin_jev-copilot_jev__jev_youtube_evidence, mcp__plugin_jev-copilot_jev__jev_youtube_export
---

Follow the `jev-research` skill.

1. First token of `$ARGUMENTS` is the playlist/channel URL; the rest is the research question (ask the user for one if it is missing, it drives the screening). Honour `--max N` as `maxVideos`.
2. Call `jev_youtube_research` with `task: "research"`. If the estimate is over budget, show it and continue only after the user confirms (`jev_youtube_job` with `resume: true, confirmOverBudget: true`).
3. Synthesize from the bundle (all twelve sections of the skill), store with `jev_youtube_export`, and summarize: corpus size, how many videos were routed deep, duplicates suppressed, best sources, report path.
