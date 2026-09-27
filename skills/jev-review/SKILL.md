---
name: jev-review
description: Verify an implementation against its requirement contract, changed files, test evidence, regression exposure and security sensitivity using JEV completion review, and repair only what the evidence shows is missing. Use before claiming a coding task is complete, when a JEV completion review reports deficiencies, or when the user runs /jev-copilot:review.
---

# JEV completion review

## Before claiming completion

1. **Reconstruct the requirement contract.** Explicit requirements are the user's words; inferred ones come from the task profile and are labeled `INF-*`. Do not drop or rephrase explicit items.
2. **Gather evidence, don't invent it.** Changed files (created / modified / deleted), test commands you actually ran with their outcomes, and a two-sentence completion claim.
3. **Run the review.** Call `jev_review_completion`. In a hooked session it already has the state; otherwise pass `request`, `requirements`, `changedFiles`, `tests`, `claim`. The `Stop` hook runs the same review automatically in `enhance` and `strict` modes.
4. **Read the verdict as typed signals**: implementation completeness, test sufficiency, unresolved-requirement probability, regression likelihood and surface, security concern, and per-requirement satisfaction/evidence strength.

## Interpreting a repair request

Each deficiency is one of:

- **`RQ-xx` not evidenced**: the requirement has no matching change. Implement it, or cite the exact file and lines that already satisfy it.
- **Test evidence insufficient**: run the relevant tests and report the real outcome. If tests genuinely do not apply, say why in one sentence.
- **Likely regression**: search for callers and dependents of what you changed; run their tests; fix or explain.
- **Security concern**: review auth, secrets, validation, permissions and trust boundaries in the diff; fix or explain.
- **Completeness low**: compare the request against the diff line by line.

Repair only the failed areas. Do not restart the task or widen scope. The loop is capped (default 2); after the cap, the review no longer blocks and the user is told manual review is recommended.

## When JEV is uncertain

A low-confidence or medium-probability signal means inspect, not fail. If the verdict recommends the verifier, delegate that single concern to the `jev-copilot:jev-verifier` agent with the files and requirement in question, and report its evidence.

## Never

- claim the review passed when it did not run,
- fabricate test output,
- treat a passing review as proof of correctness; it lowers risk, it does not eliminate it.
