import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir } from '../core/paths.js';
import { hashValue } from '../core/hash.js';
import type { JevAnswer, QuestionBundle } from './types.js';

interface CacheEntry {
  createdAt: number;
  answers: Record<string, JevAnswer>;
  responseId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CacheKeyParts {
  model: string;
  state: unknown;
  questions: QuestionBundle;
  questionSetVersion: string;
  policyVersion: string;
}

/** Content-addressed cache keyed by model + state + questions + versions (PRD FR-018). */
export class DecisionCache {
  constructor(
    private readonly enabled: boolean,
    private readonly ttlSeconds: number,
    private readonly dir: string = cacheDir(),
  ) {}

  key(parts: CacheKeyParts): string {
    return hashValue(parts);
  }

  get(key: string): CacheEntry | undefined {
    if (!this.enabled) return undefined;
    const file = join(this.dir, `${key}.json`);
    try {
      if (!existsSync(file)) return undefined;
      const entry = JSON.parse(readFileSync(file, 'utf8')) as CacheEntry;
      if (Date.now() - entry.createdAt > this.ttlSeconds * 1000) {
        unlinkSync(file);
        return undefined;
      }
      return entry;
    } catch {
      return undefined;
    }
  }

  set(key: string, entry: Omit<CacheEntry, 'createdAt'>): void {
    if (!this.enabled) return;
    try {
      writeFileSync(join(this.dir, `${key}.json`), JSON.stringify({ ...entry, createdAt: Date.now() }), 'utf8');
    } catch {
      // Cache writes are best-effort.
    }
  }
}
