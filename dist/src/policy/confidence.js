export function confidenceBand(value, config) {
    if (value === undefined)
        return 'low';
    if (value >= config.thresholds.highConfidence)
        return 'high';
    if (value >= config.thresholds.mediumConfidence)
        return 'medium';
    return 'low';
}
/** Confidence in a yes/no probability is its distance from 0.5, rescaled to 0..1. */
export function noulConfidence(p) {
    return p === undefined ? undefined : Math.min(1, Math.abs(p - 0.5) * 2);
}
export function pct(value) {
    return value === undefined ? 'n/a' : `${Math.round(value * 100)}%`;
}
