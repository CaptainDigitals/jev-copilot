import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { telemetryFile } from '../core/paths.js';
/**
 * Append-only JSONL telemetry. Records metadata only (Security §8): no prompt text,
 * no source text, no keys. `stateHash` identifies a state without revealing it.
 */
export class Telemetry {
    enabled;
    file;
    constructor(enabled, file = telemetryFile()) {
        this.enabled = enabled;
        this.file = file;
    }
    record(event) {
        if (!this.enabled)
            return;
        try {
            appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8');
        }
        catch {
            // Telemetry never breaks the caller.
        }
    }
    recordDecision(sessionId, meta, stateHash) {
        this.record({ sessionId, kind: 'decision', questionSet: meta.questionSet, questionSetVersion: meta.questionSetVersion, model: meta.model, latencyMs: meta.latencyMs, cached: meta.cached, inputTokens: meta.inputTokens, outputTokens: meta.outputTokens, costUsd: meta.costUsd, stateHash });
    }
    readSession(sessionId) {
        try {
            if (!existsSync(this.file))
                return [];
            return readFileSync(this.file, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                try {
                    return JSON.parse(line);
                }
                catch {
                    return undefined;
                }
            })
                .filter((e) => !!e && e.sessionId === sessionId);
        }
        catch {
            return [];
        }
    }
    stats(sessionId, mode, jevModel) {
        const events = this.readSession(sessionId);
        const decisions = events.filter((e) => e.kind === 'decision');
        const live = decisions.filter((e) => !e.cached);
        const latency = live.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0);
        return {
            sessionId,
            mode,
            jevModel,
            calls: decisions.length,
            cachedCalls: decisions.length - live.length,
            failures: events.filter((e) => e.kind === 'failure').length,
            avgLatencyMs: live.length ? Math.round(latency / live.length) : 0,
            estimatedInputTokens: decisions.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0),
            estimatedCostUsd: Number(decisions.reduce((sum, e) => sum + (e.costUsd ?? 0), 0).toFixed(6)),
            completionRepairs: events.filter((e) => e.kind === 'repair').length,
            toolEscalations: events.filter((e) => e.kind === 'tool_escalation').length,
            lowConfidenceFallbacks: events.filter((e) => e.kind === 'fallback').length,
            contextCandidates: events.reduce((sum, e) => sum + (e.contextCandidates ?? 0), 0),
            contextSelected: events.reduce((sum, e) => sum + (e.contextSelected ?? 0), 0),
        };
    }
}
