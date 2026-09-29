---
description: Topic research across YouTube - search, screen with JEV, route, deduplicate, synthesize with citations.
argument-hint: "<topic or question>" [extra urls] [--max N] [--collection name]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_research, mcp__plugin_jev-copilot_jev__jev_youtube_job, mcp__plugin_jev-copilot_jev__jev_youtube_bundle, mcp__plugin_jev-copilot_jev__jev_youtube_evidence, mcp__plugin_jev-copilot_jev__jev_youtube_export
---

Follow the `jev-research` skill.

1. Treat the quoted or free text in `$ARGUMENTS` as both the search topic and the research question; any URLs are extra inputs. Honour `--max N` (`maxVideos`) and `--collection name`.
2. Call `jev_youtube_research`. Default `maxVideos` is 100; suggest `mode: fast` first for very broad topics.
3. If over budget, show the estimate and wait for confirmation. If the call is interrupted, resume with `jev_youtube_job`.
4. Synthesize across sources (consensus, contradictions, unique findings, technical details, tools, procedures, failure modes, best sources, gaps, follow-ups), every claim cited. Store with `jev_youtube_export` and report the path.
