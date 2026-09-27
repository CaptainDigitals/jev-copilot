/**
 * Wire types for the OpenRouter Decisions API (TypeSafe JEV).
 * Verified against https://openrouter.ai/blog/insights/what-is-jev/ on 2026-09-26.
 */
export class JevError extends Error {
    kind;
    status;
    retryAfterMs;
    constructor(message, kind, status, retryAfterMs) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.name = 'JevError';
    }
}
