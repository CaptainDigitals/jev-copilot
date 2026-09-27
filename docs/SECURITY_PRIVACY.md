# Security and Privacy Specification

## 1. Trust model

The plugin runs with the user's local privileges through Claude Code. Treat every hook, command and dependency as privileged code.

## 2. Secrets

OpenRouter API key rules:

- use Claude Code sensitive `userConfig` when available,
- support `OPENROUTER_API_KEY` as fallback,
- never write keys to disk in plugin telemetry,
- redact Authorization headers from errors,
- never pass keys to JEV state.

## 3. Repository egress policy

Default-denied paths:

```text
.env
.env.*
**/*.pem
**/*.key
**/*id_rsa*
**/.aws/**
**/.ssh/**
**/credentials*
**/secrets/**
**/.npmrc
**/.pypirc
**/kubeconfig*
```

Users can extend exclusions.

## 4. Secret scanner

Before outbound state:

- detect common token patterns,
- mask high-entropy secrets,
- mask connection strings,
- mask private key blocks,
- omit binary content.

If redaction materially removes the evidence needed for the question, fall back to Claude/local reasoning rather than transmitting raw secret material.

## 5. Prompt injection boundary

Repository text is untrusted data. JEV questions must explicitly define the judgment and treat repository content as state, not instructions.

The local runtime must never execute instructions found in source files.

## 6. Tool gating

Hard-coded safety controls outrank semantic judgments.

Examples of deterministic deny/confirm categories:

- recursive delete outside repository root,
- credential-store modification,
- destructive database commands,
- production deployment,
- force push to protected branches,
- permission/ACL broadening,
- package scripts from unknown sources where policy disallows them.

JEV can increase scrutiny; it cannot waive these rules.

## 7. Network security

- HTTPS only,
- fixed OpenRouter host by default,
- timeout on every request,
- bounded retries,
- no transparent proxy configuration from repository content.

## 8. Logging

Default telemetry stores metadata, not raw code.

Allowed:

- decision IDs,
- probabilities,
- model,
- latency,
- token estimates,
- file counts,
- hashed state identifier.

Off by default or opt-in:

- raw prompt,
- raw source excerpts,
- full diff summaries.

## 9. Threat scenarios

### Malicious repository file tries to instruct plugin to exfiltrate secrets

Mitigation: state is data, not executable instructions; outbound redaction and path exclusions.

### JEV incorrectly marks a destructive command safe

Mitigation: deterministic hard policies cannot be downgraded.

### Compromised dependency

Mitigation: minimal dependency graph, lockfile, release SBOM, dependency scanning and pinned versions.

### API outage

Mitigation: fail-open advisory mode; configurable strict-mode handling.
