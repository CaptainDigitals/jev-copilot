---
description: Extract every part, component, tool and software mentioned across YouTube videos into a cited table.
argument-hint: <url> [...] [what the build is]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_research, mcp__plugin_jev-copilot_jev__jev_youtube_bundle, mcp__plugin_jev-copilot_jev__jev_youtube_evidence, mcp__plugin_jev-copilot_jev__jev_youtube_export
---

Follow the `jev-research` skill.

1. URLs/ids in `$ARGUMENTS` are `inputs`; remaining words describe the build (used as the question, default "Which parts, components, tools and software are used, with models, counts and prices?").
2. Call `jev_youtube_research` with `task: "parts"` and `analyzeAll: true`.
3. From the bundle, produce a table `PART | TYPE | MODEL | COUNT | PRICE | TIMESTAMP | CONFIDENCE`, one row per distinct part, merging duplicates across videos and noting disagreements (e.g. two different models for the same role). Then list software/tools and any warnings about parts that failed. Every row cites `[videoId@m:ss](url)`.
4. Store with `jev_youtube_export`.
