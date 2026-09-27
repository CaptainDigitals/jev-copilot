import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.js';
import { redactText } from '../security/redact.js';
/**
 * Debug logging is opt-in (JEV_COPILOT_DEBUG=1) and always redacted.
 * Hooks must never write to stdout except their JSON result, so logs go to a file.
 */
export function debugLog(scope, message, extra) {
    if (!process.env.JEV_COPILOT_DEBUG)
        return;
    try {
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            scope,
            message: redactText(message),
            extra: extra === undefined ? undefined : redactText(JSON.stringify(extra).slice(0, 4000)),
        });
        appendFileSync(join(dataDir(), 'debug.log'), line + '\n', 'utf8');
    }
    catch {
        // Logging must never break the caller.
    }
}
/** Produces a safe error message for telemetry and hook output. */
export function describeError(error) {
    const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return redactText(raw).slice(0, 400);
}
