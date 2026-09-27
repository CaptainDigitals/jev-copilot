import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir } from '../core/paths.js';
import { hashValue } from '../core/hash.js';
/** Content-addressed cache keyed by model + state + questions + versions (PRD FR-018). */
export class DecisionCache {
    enabled;
    ttlSeconds;
    dir;
    constructor(enabled, ttlSeconds, dir = cacheDir()) {
        this.enabled = enabled;
        this.ttlSeconds = ttlSeconds;
        this.dir = dir;
    }
    key(parts) {
        return hashValue(parts);
    }
    get(key) {
        if (!this.enabled)
            return undefined;
        const file = join(this.dir, `${key}.json`);
        try {
            if (!existsSync(file))
                return undefined;
            const entry = JSON.parse(readFileSync(file, 'utf8'));
            if (Date.now() - entry.createdAt > this.ttlSeconds * 1000) {
                unlinkSync(file);
                return undefined;
            }
            return entry;
        }
        catch {
            return undefined;
        }
    }
    set(key, entry) {
        if (!this.enabled)
            return;
        try {
            writeFileSync(join(this.dir, `${key}.json`), JSON.stringify({ ...entry, createdAt: Date.now() }), 'utf8');
        }
        catch {
            // Cache writes are best-effort.
        }
    }
}
