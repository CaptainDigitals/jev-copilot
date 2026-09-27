import { describeError } from '../core/logger.js';
import { redactText } from '../security/redact.js';
import { validateDecisionResponse } from './schema.js';
import { JevError } from './types.js';
const ALLOWED_HOSTS = new Set(['openrouter.ai']);
const USER_AGENT = 'jev-copilot-claude-code/0.1.0';
function parseRetryAfter(header) {
    if (!header)
        return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.min(seconds * 1000, 30_000);
    const date = Date.parse(header);
    if (Number.isFinite(date))
        return Math.min(Math.max(0, date - Date.now()), 30_000);
    return undefined;
}
/**
 * Thin, dependency-free client for the OpenRouter Decisions API.
 * Guarantees: HTTPS to an allowlisted host, bounded timeout, bounded retries,
 * bounded request size, validated response, and redacted error text.
 */
export class JevClient {
    options;
    fetchImpl;
    sleep;
    constructor(options) {
        this.options = options;
        const url = new URL(options.endpoint);
        if (url.protocol !== 'https:')
            throw new JevError('JEV endpoint must use https', 'config');
        if (!ALLOWED_HOSTS.has(url.hostname))
            throw new JevError(`JEV endpoint host ${url.hostname} is not allowed`, 'config');
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }
    get configured() {
        return this.options.apiKey.length > 0;
    }
    async decide(request) {
        if (!this.configured)
            throw new JevError('OPENROUTER_API_KEY is not configured', 'config');
        const body = JSON.stringify(request);
        if (body.length > this.options.maxStateChars * 1.2) {
            throw new JevError(`JEV request of ${body.length} chars exceeds the configured size guard`, 'size');
        }
        let attempt = 0;
        let lastError;
        while (attempt <= this.options.maxRetries) {
            try {
                return await this.once(body, request);
            }
            catch (error) {
                const jevError = error instanceof JevError ? error : new JevError(describeError(error), 'network');
                lastError = jevError;
                const retryable = jevError.kind === 'timeout' || jevError.kind === 'network' || jevError.kind === 'rate_limit' || (jevError.kind === 'http' && (jevError.status ?? 0) >= 500);
                if (!retryable || attempt === this.options.maxRetries)
                    break;
                const backoff = jevError.retryAfterMs ?? this.options.retryBaseDelayMs * 2 ** attempt;
                await this.sleep(backoff);
                attempt += 1;
            }
        }
        throw lastError ?? new JevError('JEV request failed', 'network');
    }
    async once(body, request) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        try {
            let response;
            try {
                response = await this.fetchImpl(this.options.endpoint, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.options.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/CaptainDigitals/jev-copilot',
                        'X-Title': 'JEV Copilot for Claude Code',
                        'User-Agent': USER_AGENT,
                    },
                    body,
                    signal: controller.signal,
                });
            }
            catch (error) {
                if (controller.signal.aborted)
                    throw new JevError(`JEV request timed out after ${this.options.timeoutMs}ms`, 'timeout');
                throw new JevError(describeError(error), 'network');
            }
            if (response.status === 429) {
                throw new JevError('OpenRouter rate limit reached', 'rate_limit', 429, parseRetryAfter(response.headers.get('retry-after')));
            }
            if (!response.ok) {
                const text = redactText(await response.text().catch(() => '')).slice(0, 500);
                throw new JevError(`OpenRouter Decisions API returned ${response.status}: ${text}`, 'http', response.status);
            }
            let json;
            try {
                json = await response.json();
            }
            catch {
                throw new JevError('OpenRouter returned a non-JSON body', 'schema');
            }
            return validateDecisionResponse(json, request.questions);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
