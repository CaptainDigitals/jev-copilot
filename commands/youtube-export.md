---
description: Write or refresh the report for a YouTube research job, merging the synthesis Claude wrote.
argument-hint: <jobId>
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_job, mcp__plugin_jev-copilot_jev__jev_youtube_bundle, mcp__plugin_jev-copilot_jev__jev_youtube_export
---

1. If `$ARGUMENTS` is empty, call `jev_youtube_job` with no arguments and ask which job to export.
2. If a synthesis for that job exists in this conversation, call `jev_youtube_export { jobId, synthesis }`; otherwise read `synthesis.md` via `jev_youtube_bundle` and, if absent, write the synthesis first following the `jev-research` skill.
3. Report the `report.md` and `report.json` paths.
