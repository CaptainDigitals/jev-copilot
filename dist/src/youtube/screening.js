import { choice, noul, score } from '../jev/schema.js';
function required(answers, id) {
    const s = score(answers, id);
    if (!s)
        throw new Error(`screening answer ${id} missing`);
    return s.score;
}
/** Maps video-level JEV answers to a screening result and computes the routing decision (PRD §20). */
export function mapVideoScreening(answers, routing, duplicateOf) {
    const relevance = required(answers, 'relevance');
    const technicalDepth = required(answers, 'technical_depth');
    const actionability = required(answers, 'actionability');
    const novelty = required(answers, 'novelty');
    const promotionalIntensity = required(answers, 'promotional_intensity');
    const evidenceDensity = required(answers, 'evidence_density');
    const type = choice(answers, 'content_type');
    const deepRecommended = noul(answers, 'deep_analysis_recommended') ?? 0;
    const confidence = Math.min(score(answers, 'relevance')?.confidence ?? 0, score(answers, 'technical_depth')?.confidence ?? 0, type?.confidence ?? 0);
    const w = routing.weights;
    const normalized = w.relevance * (relevance / 4) + w.technicalDepth * (technicalDepth / 3) + w.actionability * (actionability / 2) + w.novelty * (novelty / 2) + w.evidenceDensity * (evidenceDensity / 2);
    const promoPenalty = w.promotionPenalty * (promotionalIntensity / 2);
    const duplicatePenalty = duplicateOf ? 0.5 : 0;
    const researchValue = Math.max(0, Math.min(1, normalized - promoPenalty - duplicatePenalty));
    const reasonCodes = [];
    if (relevance < 1.5)
        reasonCodes.push('LOW_RELEVANCE');
    if (technicalDepth >= 2.5)
        reasonCodes.push('ADVANCED');
    if (actionability >= 1.5)
        reasonCodes.push('ACTIONABLE');
    if (novelty >= 1.5)
        reasonCodes.push('NOVEL');
    if (promotionalIntensity >= 1.5)
        reasonCodes.push('PROMOTIONAL');
    if (evidenceDensity >= 1.5)
        reasonCodes.push('EVIDENCE_DENSE');
    if (duplicateOf)
        reasonCodes.push('DUPLICATE');
    if (type?.choice === 'marketing')
        reasonCodes.push('MARKETING');
    let route = 'archive';
    if (duplicateOf || relevance < 1)
        route = 'archive';
    else if (researchValue >= routing.deep || (deepRecommended >= 0.85 && researchValue >= routing.focused))
        route = 'deep';
    else if (researchValue >= routing.focused)
        route = 'focused';
    else if (researchValue >= routing.archive)
        route = 'index';
    return {
        relevance,
        contentType: type?.choice ?? 'other',
        contentTypeConfidence: type?.confidence ?? 0,
        technicalDepth,
        actionability,
        novelty,
        promotionalIntensity,
        evidenceDensity,
        deepAnalysisRecommended: deepRecommended,
        confidence,
        researchValue: Number(researchValue.toFixed(3)),
        route,
        reasonCodes,
    };
}
/** Maps a batch of chunk-level answers back onto the chunks by position. */
export function mapChunkScreenings(chunks, answers) {
    return chunks.map((chunk, i) => {
        const importance = score(answers, `importance_k${i}`);
        const get = (name) => noul(answers, `${name}_k${i}`) ?? 0;
        return {
            chunkId: chunk.chunkId,
            relevant: get('relevant'),
            importance: importance?.score ?? 0,
            containsActionableSteps: get('steps'),
            containsHardware: get('hardware'),
            containsSoftware: get('software'),
            containsCode: get('code'),
            containsConfiguration: get('configuration'),
            containsMeasurements: get('measurements'),
            containsCostData: get('cost'),
            containsPerformanceClaims: get('performance'),
            containsDesignDecision: get('design'),
            containsFailureOrWarning: get('failure'),
            confidence: importance?.confidence ?? 0,
        };
    });
}
/** Chunks worth sending to the deep model, best first. `focused` routes keep only the top slice. */
export function selectChunksForDeepAnalysis(chunks, screenings, route, maxChunks) {
    const byId = new Map(screenings.map((s) => [s.chunkId, s]));
    const scored = chunks
        .map((c) => ({ chunk: c, s: byId.get(c.chunkId) }))
        .filter((x) => x.s && x.s.relevant >= 0.5)
        .sort((a, b) => (b.s?.importance ?? 0) + (b.s?.relevant ?? 0) - ((a.s?.importance ?? 0) + (a.s?.relevant ?? 0)));
    const limit = route === 'deep' ? maxChunks : Math.max(1, Math.ceil(maxChunks / 3));
    return scored.slice(0, limit).map((x) => x.chunk).sort((a, b) => a.startSeconds - b.startSeconds);
}
/**
 * Cheap duplicate detection (PRD §27, MVP subset): near-identical titles from the same channel,
 * or transcripts whose shingle overlap exceeds 60%. Returns a map of duplicate -> canonical id.
 */
export function detectDuplicates(videos) {
    const dupes = new Map();
    const shingles = videos.map((v) => ({ id: v.videoId, set: shingleSet(v.text) }));
    for (let i = 0; i < videos.length; i += 1) {
        const a = videos[i];
        if (!a || dupes.has(a.videoId))
            continue;
        for (let j = i + 1; j < videos.length; j += 1) {
            const b = videos[j];
            if (!b || dupes.has(b.videoId))
                continue;
            const sameTitle = a.channelId === b.channelId && normalizeTitle(a.title) === normalizeTitle(b.title);
            const overlap = jaccard(shingles[i]?.set ?? new Set(), shingles[j]?.set ?? new Set());
            if (sameTitle || overlap >= 0.6)
                dupes.set(b.videoId, a.videoId);
        }
    }
    return dupes;
}
function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function shingleSet(text, size = 8) {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 4000);
    const set = new Set();
    for (let i = 0; i + size <= words.length; i += 1)
        set.add(words.slice(i, i + size).join(' '));
    return set;
}
function jaccard(a, b) {
    if (!a.size || !b.size)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter += 1;
    return inter / (a.size + b.size - inter);
}
