import type { Config } from '../core/config.js';
import { noul, score } from '../jev/schema.js';
import type { JevAnswer } from '../jev/types.js';
import type { ContextCandidate } from '../jev/questions/context.js';

export type ContextBand = 'full' | 'excerpt' | 'fallback';

export interface RankedCandidate {
  path: string;
  role?: string;
  relevance: number;
  confidence: number;
  needsFullContent: number;
  band: ContextBand;
}

/**
 * Maps per-candidate JEV answers back onto the real candidate list. Only paths from
 * `candidates` can appear in the output, by construction.
 */
export function rankCandidates(candidates: readonly ContextCandidate[], answers: Record<string, JevAnswer>, config: Config, offset = 0): RankedCandidate[] {
  const bands = config.thresholds.context;
  const ranked: RankedCandidate[] = [];
  candidates.forEach((candidate, index) => {
    const id = `c${index + offset}`;
    const relevance = score(answers, `relevance_${id}`);
    const needsFull = noul(answers, `needs_full_${id}`);
    if (!relevance || needsFull === undefined) return;
    let band: ContextBand = 'fallback';
    if (relevance.score >= bands.full) band = 'full';
    else if (relevance.score >= bands.excerpt) band = 'excerpt';
    const item: RankedCandidate = { path: candidate.path, relevance: relevance.score, confidence: relevance.confidence, needsFullContent: needsFull, band };
    if (candidate.role) item.role = candidate.role;
    ranked.push(item);
  });
  return ranked.sort((a, b) => b.relevance - a.relevance);
}

export function contextSummary(ranked: readonly RankedCandidate[]): string {
  const full = ranked.filter((r) => r.band === 'full');
  const excerpt = ranked.filter((r) => r.band === 'excerpt');
  const fallback = ranked.filter((r) => r.band === 'fallback');
  const list = (items: readonly RankedCandidate[]): string => items.map((r) => `${r.path} (${r.relevance.toFixed(1)})`).join(', ') || 'none';
  return [
    `JEV context ranking: ${full.length} read fully, ${excerpt.length} excerpt, ${fallback.length} fallback.`,
    `- read fully: ${list(full)}`,
    `- excerpt/skim: ${list(excerpt)}`,
    `- fallback (still available if evidence points to them): ${list(fallback)}`,
    'Low relevance is not proof of irrelevance; follow dependency evidence over these scores.',
  ].join('\n');
}
