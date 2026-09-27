const MAX_REQUIREMENTS = 12;
const MIN_LEN = 12;
const IMPERATIVE = /^(?:please\s+)?(?:add|build|create|implement|fix|make|update|change|remove|delete|refactor|rename|move|migrate|write|generate|ensure|support|handle|validate|return|show|display|render|convert|replace|expose|wire|hook|document|test|cover|deploy|configure|set\s+up|setup|install|integrate|prevent|allow|disallow|use|switch|upgrade|downgrade|extract|split|merge|optimize|cache|log|track|store|persist|load|parse|send|fetch|call|include|exclude|never|always|must|should|don'?t|do\s+not)\b/i;
const NEGATIVE = /\b(?:never|must\s+not|do\s+not|don'?t|no\s+\w+\s+(?:should|may))\b/i;
function splitUnits(prompt) {
    const lines = prompt.replace(/\r/g, '').split('\n');
    const units = [];
    for (const rawLine of lines) {
        const line = rawLine.trim().replace(/^(?:[-*+•]|\d+[.)]|\[[ x]\])\s+/i, '');
        if (!line)
            continue;
        if (/^```/.test(line))
            continue;
        for (const sentence of line.split(/(?<=[.!?;])\s+(?=[A-Z(])|,\s+(?:and\s+)?(?:also|then)\s+/)) {
            const s = sentence.trim();
            if (s.length >= MIN_LEN)
                units.push(s);
        }
    }
    return units;
}
function verificationFor(text) {
    if (/\btests?\b|coverage|spec\b/i.test(text))
        return 'tests';
    if (/\b(?:readme|docs?|documentation|changelog|comment)\b/i.test(text))
        return 'docs';
    if (/\b(?:review|audit|verify|check|ensure|secure|safe)\b/i.test(text))
        return 'review';
    return 'diff';
}
/**
 * Deterministically extracts explicit requirements from the user's prompt and appends
 * inferred requirements from the JEV task profile, clearly labeled (PRD FR-009).
 * Explicit requirements are quoted verbatim so nothing is rephrased away.
 */
export function buildRequirementContract(prompt, profile, thresholds) {
    const units = splitUnits(prompt);
    const explicit = [];
    const seen = new Set();
    for (const unit of units) {
        const key = unit.toLowerCase();
        if (seen.has(key))
            continue;
        const core = unit.replace(/^(?:also|then|and|additionally|finally|next|lastly|plus)[,\s]+/i, '');
        const isRequirement = IMPERATIVE.test(core) || /\b(?:should|must|needs? to|has to|so that|make sure)\b/i.test(unit);
        if (!isRequirement)
            continue;
        seen.add(key);
        explicit.push({
            id: `RQ-${String(explicit.length + 1).padStart(2, '0')}`,
            source: 'explicit',
            text: unit.slice(0, 300),
            verification: verificationFor(unit),
            severity: NEGATIVE.test(unit) || /\bmust\b|never|security|secret/i.test(unit) ? 'high' : 'medium',
            status: 'open',
        });
        if (explicit.length >= MAX_REQUIREMENTS)
            break;
    }
    if (!explicit.length && prompt.trim()) {
        explicit.push({ id: 'RQ-01', source: 'explicit', text: prompt.trim().slice(0, 300), verification: 'diff', severity: 'medium', status: 'open' });
    }
    const inferred = [];
    if (profile) {
        if (profile.testsRequired >= thresholds.testsRequired && !explicit.some((r) => r.verification === 'tests')) {
            inferred.push({ id: 'INF-TEST', source: 'inferred', text: 'Provide test evidence for the change (JEV indicated tests are normally required).', verification: 'tests', severity: 'medium', status: 'open' });
        }
        if (profile.securitySensitive >= thresholds.securitySensitive) {
            inferred.push({ id: 'INF-SEC', source: 'inferred', text: 'Do not weaken authentication, authorization, validation or secret handling; review the change for security regressions.', verification: 'review', severity: 'high', status: 'open' });
        }
        if (profile.dataChangeSensitive >= thresholds.securitySensitive) {
            inferred.push({ id: 'INF-DATA', source: 'inferred', text: 'Schema or data changes include a migration and a rollback path.', verification: 'diff', severity: 'high', status: 'open' });
        }
    }
    return [...explicit, ...inferred];
}
