---
description: Ask a follow-up question over the transcripts of a research job or collection.
argument-hint: <jobId or collection> "<question>"
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_ask, mcp__plugin_jev-copilot_jev__jev_youtube_job, mcp__plugin_jev-copilot_jev__jev_youtube_evidence
---

1. First token of `$ARGUMENTS` is the job id or collection name (call `jev_youtube_job` with no arguments if the user does not know it); the rest is the question.
2. Call `jev_youtube_ask`. Answer strictly from the returned cited chunks, keeping each `[videoId@m:ss](url)` citation next to the claim it supports. Pull more context with `jev_youtube_evidence` when a chunk is truncated.
3. If nothing matched, say so and propose a new `/jev-copilot:youtube-research` query.
