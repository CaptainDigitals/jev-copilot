import { createHash } from 'node:crypto';
/** Deterministic JSON serialization with sorted keys so equal states hash equally. */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const record = value;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}
export function sha256(input) {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}
export function hashValue(value) {
    return sha256(stableStringify(value));
}
