import { isRecord } from '../core/config.js';
/** Rough token estimate used for chunk sizing and cost estimates. */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/** Parses YouTube json3 caption events into timed segments. Raw text is preserved verbatim. */
export function parseJson3(events, videoId, source, language) {
    const segments = [];
    const rawParts = [];
    for (const event of events) {
        if (!isRecord(event) || !Array.isArray(event.segs))
            continue;
        const text = event.segs
            .map((s) => (isRecord(s) && typeof s.utf8 === 'string' ? s.utf8 : ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text)
            continue;
        const start = typeof event.tStartMs === 'number' ? event.tStartMs / 1000 : 0;
        const duration = typeof event.dDurationMs === 'number' ? event.dDurationMs / 1000 : 0;
        rawParts.push(text);
        const previous = segments[segments.length - 1];
        // Auto captions repeat the rolling line; drop exact repeats of the previous segment.
        if (previous && previous.text === text) {
            previous.endSeconds = Math.max(previous.endSeconds, start + duration);
            continue;
        }
        segments.push({ startSeconds: start, endSeconds: start + duration, text });
    }
    return { videoId, source, language, segments, rawText: rawParts.join('\n'), retrievedAt: new Date().toISOString() };
}
const FILLERS = /\b(?:um+|uh+|erm|you know,?|sort of,?|kind of,?|like,)\s/gi;
/** Light normalization for analysis: filler reduction, spacing, sentence capitalization. Never mutates the source transcript. */
export function normalizeText(text) {
    const cleaned = text
        .replace(/\[(?:music|applause|laughter|inaudible|__)\]/gi, ' ')
        .replace(FILLERS, ' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => `${p}${c.toUpperCase()}`);
}
function chapterAt(chapters, seconds) {
    return chapters.find((c) => seconds >= c.startSeconds && seconds < c.endSeconds)?.title;
}
/**
 * Splits a transcript into timestamped chunks. Boundaries prefer chapter changes, then sentence
 * ends, then the token target; a chunk never splits a caption segment mid-sentence.
 */
export function chunkTranscript(transcript, chapters, options) {
    const chunks = [];
    let current = [];
    let currentTokens = 0;
    let currentChapter = chapterAt(chapters, transcript.segments[0]?.startSeconds ?? 0);
    const flush = () => {
        if (!current.length)
            return;
        const first = current[0];
        const last = current[current.length - 1];
        if (!first || !last)
            return;
        const text = normalizeText(current.map((s) => s.text).join(' '));
        const chunk = {
            chunkId: `${transcript.videoId}:${String(chunks.length).padStart(4, '0')}`,
            videoId: transcript.videoId,
            startSeconds: Math.floor(first.startSeconds),
            endSeconds: Math.ceil(last.endSeconds),
            text,
            tokenCount: estimateTokens(text),
        };
        if (currentChapter)
            chunk.chapter = currentChapter;
        chunks.push(chunk);
        current = [];
        currentTokens = 0;
    };
    for (const segment of transcript.segments) {
        const chapter = chapterAt(chapters, segment.startSeconds);
        const tokens = estimateTokens(segment.text);
        const chapterChanged = chapter !== currentChapter && currentTokens >= options.minTokens;
        // Prefer to close a chunk right after a segment that completes a sentence.
        const sentenceEnd = /[.!?]["')\]]?$/.test(current[current.length - 1]?.text ?? '');
        const overTarget = currentTokens >= options.targetTokens && sentenceEnd;
        const overMax = currentTokens + tokens > options.maxTokens;
        if (current.length && (chapterChanged || overTarget || overMax))
            flush();
        if (!current.length)
            currentChapter = chapter;
        current.push(segment);
        currentTokens += tokens;
    }
    flush();
    // Merge a trailing fragment into its predecessor so tiny chunks do not reach JEV alone.
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last && prev && last.tokenCount < options.minTokens && prev.tokenCount + last.tokenCount <= options.maxTokens) {
        const merged = { ...prev, endSeconds: last.endSeconds, text: `${prev.text} ${last.text}`, tokenCount: prev.tokenCount + last.tokenCount };
        return [...chunks.slice(0, -2), merged];
    }
    return chunks;
}
export function formatTimestamp(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
