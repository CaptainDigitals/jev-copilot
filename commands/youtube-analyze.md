---
description: Deep-analyze one YouTube video with JEV screening and a cited synthesis.
argument-hint: <url or video id> [research question]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_research, mcp__plugin_jev-copilot_jev__jev_youtube_bundle, mcp__plugin_jev-copilot_jev__jev_youtube_evidence, mcp__plugin_jev-copilot_jev__jev_youtube_export
---

Follow the `jev-research` skill.

1. Take the first token of `$ARGUMENTS` as the video URL/id and the rest as the research question (default: "What does this video teach, claim and demonstrate?").
2. Call `jev_youtube_research` with `inputs: [url]`, `task: "analyze"`, `analyzeAll: true`, `maxVideos: 1` and the question.
3. Read the returned bundle (page with `jev_youtube_bundle` if `nextOffset` is set) and write the synthesis: what the video covers, key claims (demonstrated vs stated), technical details, tools/components, procedures, failure modes, and which timestamps deserve watching. Cite every claim as `[videoId@m:ss](url)`.
4. Store it with `jev_youtube_export { jobId, synthesis }` and give the user the report path.

If yt-dlp is missing or the video has no transcript, report that plainly; do not invent content.
