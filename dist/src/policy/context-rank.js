import { noul, score } from '../jev/schema.js';
/**
 * Maps per-candidate JEV answers back onto the real candidate list. Only paths from
 * `candidates` can appear in the output, by construction.
 */
export function rankCandidates(candidates, answers, config, offset = 0) {
    const bands = config.thresholds.context;
    const ranked = [];
    candidates.forEach((candidate, index) => {
        const id = `c${index + offset}`;
        const relevance = score(answers, `relevance_${id}`);
        const needsFull = noul(answers, `needs_full_${id}`);
        if (!relevance || needsFull === undefined)
            return;
        let band = 'fallback';
        if (relevance.score >= bands.full)
            band = 'full';
        else if (relevance.score >= bands.excerpt)
            band = 'excerpt';
        const item = { path: candidate.path, relevance: relevance.score, confidence: relevance.confidence, needsFullContent: needsFull, band };
        if (candidate.role)
            item.role = candidate.role;
        ranked.push(item);
    });
    return ranked.sort((a, b) => b.relevance - a.relevance);
}
export function contextSummary(ranked) {
    const full = ranked.filter((r) => r.band === 'full');
    const excerpt = ranked.filter((r) => r.band === 'excerpt');
    const fallback = ranked.filter((r) => r.band === 'fallback');
    const list = (items) => items.map((r) => `${r.path} (${r.relevance.toFixed(1)})`).join(', ') || 'none';
    return [
        `JEV context ranking: ${full.length} read fully, ${excerpt.length} excerpt, ${fallback.length} fallback.`,
        `- read fully: ${list(full)}`,
        `- excerpt/skim: ${list(excerpt)}`,
        `- fallback (still available if evidence points to them): ${list(fallback)}`,
        'Low relevance is not proof of irrelevance; follow dependency evidence over these scores.',
    ].join('\n');
}
