# Build Handoff for Claude Code

Use this directory as the source of truth for implementation.

## Recommended implementation prompt

Build the JEV Copilot plugin described in `docs/MASTER_PRD.md` and supporting specifications. Start from `starter-plugin/`. Implement one phase at a time and preserve the architectural rule that JEV performs bounded typed judgments while Claude performs open-ended reasoning and generation.

Before modifying code:

1. read the master PRD,
2. read the Claude Code integration spec,
3. read the decision contracts,
4. inspect current Claude Code plugin/hook docs if API details may have changed,
5. inspect current OpenRouter JEV Decisions API docs.

Implementation constraints:

- TypeScript strict mode,
- no placeholders in finished phase code,
- full input validation,
- all secrets redacted,
- no arbitrary shell interpolation,
- deterministic safety rules override JEV,
- bounded network timeouts,
- all behavior unit tested,
- run `claude plugin validate . --strict`,
- update documentation whenever schema/behavior changes.

## Phase-one deliverables

1. valid plugin manifest,
2. secure configuration,
3. `/jev-copilot:status`,
4. `/jev-copilot:analyze`,
5. OpenRouter/JEV client,
6. schema validation,
7. local telemetry,
8. unit tests,
9. CI validation.

Do not implement automatic tool gating until prompt analysis and completion review are evaluated.
