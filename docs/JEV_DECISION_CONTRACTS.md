# JEV Decision Contracts

This file defines the product-level schemas. Exact SDK wire shapes should follow the current OpenRouter/TypeSafe API at implementation time.

## 1. Task analysis

### State

```ts
interface TaskAnalysisState {
  userRequest: string;
  repo?: {
    languages?: string[];
    topLevelPaths?: string[];
    changedFiles?: string[];
  };
}
```

### Questions

- `task_type`: Choice
  - feature
  - bug_fix
  - refactor
  - migration
  - test
  - documentation
  - investigation
  - security
  - configuration
  - mixed

- `complexity`: Score
  - 0: localized and straightforward
  - 1: moderate repository reasoning
  - 2: multiple components or nontrivial dependencies
  - 3: architecture-sensitive or high uncertainty

- `requires_repo_exploration`: Noul
- `cross_file_scope`: Noul
- `tests_required`: Noul
- `security_sensitive`: Noul
- `requirements_ambiguous`: Noul

### Product output

```ts
interface TaskProfile {
  taskType: string;
  taskTypeConfidence: number;
  complexity: number;
  complexityConfidence: number;
  requiresRepoExploration: number;
  crossFileScope: number;
  testsRequired: number;
  securitySensitive: number;
  requirementsAmbiguous: number;
}
```

## 2. Context relevance

For each candidate:

- `relevance`: Score
  - 0: unrelated
  - 1: possibly useful background
  - 2: likely relevant
  - 3: directly required

Optional:

- `needs_full_content`: Noul

Policy example:

```text
score >= 2.4 -> include full content if size permits
1.5-2.39    -> include excerpt/summary
<1.5        -> keep as fallback only
```

Do not hard-code these values for all repositories; tune with evals.

## 3. Requirement coverage

State for each requirement contains:

```ts
interface RequirementEvidence {
  requirementId: string;
  requirement: string;
  explicit: boolean;
  changedFiles: string[];
  diffSummary: string;
  testEvidence?: string;
}
```

Questions:

- `satisfied`: Noul
- `evidence_strength`: Score
  - 0 no evidence
  - 1 indirect evidence
  - 2 plausible direct evidence
  - 3 strong direct evidence

Policy should require stronger evidence for explicit high-severity requirements.

## 4. Regression risk

Question: `regression_risk` Score

Levels:

0. isolated; unlikely to alter existing behavior outside stated scope  
1. limited shared behavior; modest regression surface  
2. shared interfaces/data/control flow changed; significant regression surface  
3. broad infrastructure/schema/security behavior changed; high regression surface

## 5. Security sensitivity

Prefer multiple narrow nouls rather than one vague question:

- touches_authentication
- touches_authorization
- handles_credentials_or_secrets
- changes_input_validation
- changes_crypto_or_signing
- changes_network_trust_boundary
- changes_dependency_execution
- changes_permission_or_privilege_behavior

The code may combine these using explicit policy.

## 6. Tool action assessment

The state should include parsed action semantics rather than blindly passing raw shell strings only.

```ts
interface ToolActionState {
  toolName: string;
  operation: string;
  targets: string[];
  parsedCommand?: string;
  modifiesFilesystem: boolean;
  recursive: boolean;
  affectsRepoBoundary: boolean;
  touchesCredentials: boolean;
  deploymentRelated: boolean;
}
```

Questions:

- `impact`: Choice
  - low
  - ordinary
  - high
  - destructive

- `task_relevant`: Noul
- `requires_human_confirmation`: Noul

JEV cannot downgrade deterministic `hardDeny=true`.

## 7. Completion review

Questions:

- `implementation_complete`: Noul
- `tests_sufficient`: Noul
- `has_unresolved_requirement`: Noul
- `has_likely_regression`: Noul
- `has_security_concern`: Noul
- `needs_additional_repository_check`: Noul

Policy example in enhance mode:

```text
implementation_complete < 0.80 -> ask Claude to re-check
has_unresolved_requirement > 0.35 -> repair review
has_likely_regression > 0.65 -> independent verification
has_security_concern > 0.40 -> security review
```

Strict mode thresholds are higher/lower as appropriate and must be calibrated.

## 8. Versioning

Every question bundle gets a semantic version:

```ts
const QUESTION_SET_VERSION = "1.0.0";
```

Telemetry stores this version. Threshold calibration is tied to both JEV model ID and question-set version.
