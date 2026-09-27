# Test and Evaluation Plan

## 1. Unit tests

Test:

- config parsing,
- redaction,
- hashing/cache keys,
- policy thresholds,
- retry logic,
- response schema validation,
- tool deterministic classification,
- requirement-contract lifecycle,
- telemetry sanitization.

## 2. Contract tests

Mock the OpenRouter Decisions API and verify:

- noul mapping,
- choice mapping,
- score mapping,
- malformed response handling,
- timeout handling,
- rate-limit handling.

## 3. Plugin validation tests

CI command:

```bash
claude plugin validate . --strict
```

Validate on:

- Windows,
- macOS,
- Linux.

## 4. Hook tests

Replay captured synthetic hook payloads for:

- UserPromptSubmit,
- PreToolUse,
- PostToolUse,
- TaskCompleted,
- Stop,
- SessionStart,
- SessionEnd.

Assertions:

- correct no-op paths,
- no secret leakage,
- valid JSON output,
- bounded execution time.

## 5. Eval dataset

Create `tests/evals/cases.jsonl` with fields:

```json
{
  "id": "feature-001",
  "request": "...",
  "expected": {
    "taskType": "feature",
    "testsRequired": true,
    "securitySensitive": false
  }
}
```

## 6. Context ranking eval

For each task:

- define gold relevant files,
- generate candidate set,
- score recall@3, recall@5, recall@10,
- measure number of irrelevant files passed to Claude.

Do not optimize only precision. Missing a required file is worse than carrying a few extra candidates.

## 7. Completion eval

Create intentionally incomplete patches:

- missing validation,
- missing migration,
- missing test,
- partial UI update,
- API changed without downstream consumer update,
- security regression.

Measure:

- true incomplete detection,
- false repair requests,
- repair-loop success.

## 8. Tool-risk eval

Cases:

- `git status` -> low
- `cat file` -> low
- normal source edit -> ordinary
- `git reset --hard` -> high/destructive
- recursive delete -> destructive
- production deploy -> high
- permission broadening -> high

Deterministic rule tests must pass independently of JEV.

## 9. Threshold calibration

For each JEV model/question-set version:

1. run labeled eval set,
2. capture probability distributions,
3. sweep thresholds,
4. choose thresholds based on business cost of false positives/negatives,
5. save a versioned calibration profile.

Never copy cookbook thresholds blindly into production policy.

## 10. Performance tests

Measure:

- p50/p95 JEV latency,
- hook total execution time,
- cache hit rate,
- number of requests per session,
- aggregate JEV input tokens,
- change in Claude context tokens.

## 11. Security tests

Include fixtures containing fake:

- API keys,
- PEM private keys,
- database URLs,
- JWTs,
- `.env` secrets.

Assert outbound serialized state does not contain them.
