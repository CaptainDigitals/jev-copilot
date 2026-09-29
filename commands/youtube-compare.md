---
description: Compare approaches, products or designs across several YouTube videos.
argument-hint: <url> <url> [...] [comparison question]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_youtube_research, mcp__plugin_jev-copilot_jev__jev_youtube_bundle, mcp__plugin_jev-copilot_jev__jev_youtube_evidence, mcp__plugin_jev-copilot_jev__jev_youtube_export
---

Follow the `jev-research` skill.

1. Collect every URL/id in `$ARGUMENTS` as `inputs`; the remaining words are the comparison question (default: "How do these sources' approaches, components, results and trade-offs compare?").
2. Call `jev_youtube_research` with `task: "compare"` and `analyzeAll: true`.
3. Write the synthesis with a comparison table (one column per source; rows for approach, components, specifications, results, cost, trade-offs, evidence quality) followed by consensus, contradictions and a recommendation that is explicitly conditional on the evidence. Cite every cell that carries a claim.
4. Store with `jev_youtube_export`.
