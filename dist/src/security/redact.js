/**
 * Outbound redaction. Repository text is untrusted data and may contain secrets.
 * Everything sent to OpenRouter as JEV state passes through redactValue first.
 */
const PATTERNS = [
    { name: 'openrouter', regex: /sk-or-v1-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_OPENROUTER_KEY]' },
    { name: 'openai', regex: /sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
    { name: 'anthropic', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
    { name: 'github', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
    { name: 'github-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
    { name: 'aws-access', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
    { name: 'slack', regex: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g, replacement: '[REDACTED_SLACK_TOKEN]' },
    { name: 'stripe', regex: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED_STRIPE_KEY]' },
    { name: 'google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: '[REDACTED_GOOGLE_KEY]' },
    { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[REDACTED_JWT]' },
    { name: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
    { name: 'private-key-open', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, replacement: '[REDACTED_PRIVATE_KEY]' },
    { name: 'bearer', regex: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, replacement: '$1 [REDACTED_TOKEN]' },
    { name: 'authorization-header', regex: /(authorization\s*[:=]\s*)["']?[^"'\s,}]{12,}/gi, replacement: '$1[REDACTED_TOKEN]' },
    {
        name: 'connection-string',
        regex: /\b([a-z][a-z0-9+.-]*):\/\/([^\s:@/]+):([^\s@/]+)@/gi,
        replacement: '$1://$2:[REDACTED_PASSWORD]@',
    },
    {
        name: 'env-assignment',
        regex: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)[A-Z0-9_]*)(\s*[=:]\s*)["']?(?!\[REDACTED)([^\s"'#]{6,})["']?/g,
        replacement: '$1$2[REDACTED_SECRET]',
    },
    {
        name: 'json-secret-field',
        regex: /("(?:[a-zA-Z0-9_-]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key)[a-zA-Z0-9_-]*)"\s*:\s*)"(?!\[REDACTED)[^"]{6,}"/gi,
        replacement: '$1"[REDACTED_SECRET]"',
    },
];
const HIGH_ENTROPY = /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;
function shannonEntropy(text) {
    const counts = new Map();
    for (const ch of text)
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) {
        const p = count / text.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}
function maskHighEntropy(text) {
    return text.replace(HIGH_ENTROPY, (match) => {
        // Hex hashes (git SHAs, sha256) are not secrets; keep them.
        if (/^[a-f0-9]+$/i.test(match))
            return match;
        // Paths and dotted identifiers rarely have entropy this high; require mixed classes.
        const mixed = /[a-z]/.test(match) && /[A-Z]/.test(match) && /[0-9]/.test(match);
        if (!mixed)
            return match;
        return shannonEntropy(match) >= 4.2 ? '[REDACTED_HIGH_ENTROPY]' : match;
    });
}
export function redactTextDetailed(input) {
    let text = input;
    let redactions = 0;
    for (const pattern of PATTERNS) {
        const hits = text.match(pattern.regex)?.length ?? 0;
        if (!hits)
            continue;
        redactions += hits;
        text = text.replace(pattern.regex, pattern.replacement);
    }
    const masked = maskHighEntropy(text);
    if (masked !== text)
        redactions += 1;
    return { text: masked, redactions };
}
export function redactText(input) {
    return redactTextDetailed(input).text;
}
/** Deep-redacts strings inside any JSON-like value and returns a new value. */
export function redactValue(value) {
    if (typeof value === 'string')
        return redactText(value);
    if (Array.isArray(value))
        return value.map((v) => redactValue(v));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = redactValue(v);
        return out;
    }
    return value;
}
/** True when text looks binary (NUL bytes or a high ratio of control characters). */
export function looksBinary(text) {
    if (text.includes('\u0000'))
        return true;
    const sample = text.slice(0, 2000);
    if (!sample.length)
        return false;
    let control = 0;
    for (const ch of sample) {
        const code = ch.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13)
            control += 1;
    }
    return control / sample.length > 0.05;
}
