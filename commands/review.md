---
description: Run a JEV completion review of the current implementation against its requirement contract.
argument-hint: [optional completion claim]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_review_completion, Read, Grep, Bash(git diff *), Bash(git status *)
---

Follow the `jev-review` skill.

1. Call `jev_review_completion` with `claim` set to `$ARGUMENTS` or to a two-sentence summary of what you implemented. With no other arguments it uses the session state the hooks tracked (request, requirement contract, changed files, test evidence). If the hooks have no state, pass `request`, `requirements`, `changedFiles`, `tests` and `claim` explicitly, using only real evidence.
2. Print the `rendered` block verbatim.
3. If the decision is `repair required`, address each deficiency with repository evidence: make the missing change, run the missing test, or cite the specific file and lines that already satisfy the item. If a deficiency is mistaken, say precisely why. Do not restart the task.
4. If the verdict suggests the verifier, delegate the flagged concern to the `jev-copilot:jev-verifier` agent and report its evidence-based conclusion.

Never claim the review passed if the tool did not run; say so and describe what remains unverified.
