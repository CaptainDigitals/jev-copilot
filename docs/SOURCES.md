# Source references used for this PRD

These links should be re-checked during implementation because Claude Code and model APIs can change.

## Claude Code

- Plugins overview: https://code.claude.com/docs/en/plugins
- Plugin manifest reference: https://code.claude.com/docs/en/plugins-reference
- Hooks reference: https://code.claude.com/docs/en/hooks
- Skills: https://code.claude.com/docs/en/skills

Key implementation facts verified September 26, 2026:

- Plugins can package skills, agents, hooks and MCP servers as one unit.
- Plugin manifests live at `.claude-plugin/plugin.json`.
- Claude Code hook events include `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `TaskCompleted`, `Stop`, `SessionStart`, `SessionEnd`, model-switch events and others.
- `UserPromptSubmit` can inject `additionalContext` but cannot rewrite the user prompt.
- `Stop` can prevent Claude from stopping and continue the conversation.
- `PreToolUse` can block tool execution.
- Sensitive plugin `userConfig` values can be stored through Claude Code's secure configuration mechanism.

## TypeSafe / JEV

- TypeSafe skills repository: https://github.com/typesafe-ai/skills
- JEV announcement: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- TypeSafe docs: https://docs.typesafe.ai/

The TypeSafe Agent Skill describes JEV as a System One model that returns typed judgments and probabilities and recommends using Choice, Noul and Score as bounded semantic primitives.

## OpenRouter

- JEV 1.13: https://openrouter.ai/typesafe/jev-1.13
- Typesafe models: https://openrouter.ai/typesafe
- JEV explainer/API examples: https://openrouter.ai/blog/insights/what-is-jev/

Verified September 26, 2026:

- model: `typesafe/jev-1.13`
- Decisions endpoint: `POST https://openrouter.ai/api/alpha/decisions`
- context: 32K for JEV 1.13
- listed price: $0.042 / 1M input tokens and $0 / 1M output tokens
- rolling alias: `~typesafe/jev-latest`

Pricing, aliases and API details should be checked before release.
