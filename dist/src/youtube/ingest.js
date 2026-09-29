import { isRecord } from '../core/config.js';
import { debugLog, describeError } from '../core/logger.js';
import { isVideoId, videoUrl } from './resolver.js';
import { parseJson3 } from './transcript.js';
import { YtDlpError } from './ytdlp.js';
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function str(value, max = 5000) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}
function parseChapters(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter(isRecord)
        .map((c) => ({ title: str(c.title, 200), startSeconds: num(c.start_time), endSeconds: num(c.end_time) }))
        .filter((c) => c.endSeconds > c.startSeconds)
        .slice(0, 200);
}
function uploadDate(value) {
    const s = str(value, 8);
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}
export function toMetadata(raw) {
    const id = str(raw.id, 11);
    if (!isVideoId(id))
        throw new Error('yt-dlp metadata has no valid video id');
    const subtitles = isRecord(raw.subtitles) ? raw.subtitles : {};
    const auto = isRecord(raw.automatic_captions) ? raw.automatic_captions : {};
    return {
        videoId: id,
        url: videoUrl(id),
        title: str(raw.title, 300),
        channelName: str(raw.channel ?? raw.uploader, 200),
        channelId: str(raw.channel_id ?? raw.uploader_id, 64),
        description: str(raw.description, 4000),
        publishedAt: uploadDate(raw.upload_date),
        durationSeconds: num(raw.duration),
        views: num(raw.view_count),
        likes: num(raw.like_count),
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string').slice(0, 40) : [],
        chapters: parseChapters(raw.chapters),
        thumbnailUrl: str(raw.thumbnail, 500),
        language: str(raw.language, 12),
        hasManualCaptions: Object.keys(subtitles).length > 0,
        hasAutoCaptions: Object.keys(auto).length > 0,
        retrievedAt: new Date().toISOString(),
    };
}
export function statusFromError(error) {
    if (error instanceof YtDlpError) {
        if (error.failure === 'PRIVATE')
            return 'PRIVATE';
        if (error.failure === 'DELETED')
            return 'DELETED';
        if (error.failure === 'UNAVAILABLE')
            return 'UNAVAILABLE';
    }
    return 'PROCESSING_FAILED';
}
/** Expands playlists, channels, searches, files and collections into an ordered, de-duplicated video id list (PRD §7). */
export async function discoverVideos(sources, ytdlp, store, maxVideos) {
    const seen = new Map();
    const add = (id, title) => {
        if (isVideoId(id) && !seen.has(id) && seen.size < maxVideos)
            seen.set(id, title ? { videoId: id, title } : { videoId: id });
    };
    for (const source of sources) {
        if (seen.size >= maxVideos)
            break;
        const remaining = maxVideos - seen.size;
        try {
            if (source.kind === 'video' || source.kind === 'file')
                source.videoIds.forEach((id) => add(id));
            else if (source.kind === 'collection')
                store.loadCollection(source.value).videoIds.forEach((id) => add(id));
            else if (source.kind === 'search')
                (await ytdlp.search(source.value, remaining)).forEach((e) => add(str(e.id, 11), str(e.title, 300)));
            else
                (await ytdlp.listEntries(source.value, remaining)).forEach((e) => add(str(e.id, 11), str(e.title, 300)));
        }
        catch (error) {
            debugLog('youtube:discover', `source ${source.kind} failed`, describeError(error));
            throw error;
        }
    }
    return [...seen.values()];
}
/** Fetches metadata and captions for one video, honouring the cross-job cache. Media is never downloaded. */
export async function ingestVideo(videoId, ytdlp, store, options) {
    let metadata = store.getMetadata(videoId);
    if (!metadata) {
        try {
            metadata = toMetadata(await ytdlp.videoInfo(videoUrl(videoId)));
            store.putMetadata(metadata);
        }
        catch (error) {
            return { status: statusFromError(error), error: describeError(error) };
        }
    }
    const cached = store.getTranscript(videoId);
    if (cached)
        return { status: 'READY', metadata, transcript: cached };
    if (store.hasNoTranscriptMarker(videoId))
        return { status: options.enableAsrFallback ? 'TRANSCRIPTION_REQUIRED' : 'NO_TRANSCRIPT', metadata };
    const language = options.languages[0] ?? 'en';
    const attempts = [];
    if (metadata.hasManualCaptions)
        attempts.push({ manual: true });
    if (metadata.hasAutoCaptions)
        attempts.push({ manual: false });
    if (!attempts.length)
        attempts.push({ manual: true }, { manual: false });
    let lastError;
    for (const attempt of attempts) {
        try {
            const result = await ytdlp.captions(metadata.url, language, attempt.manual);
            if (!result || !result.events.length)
                continue;
            const transcript = parseJson3(result.events, videoId, attempt.manual ? 'MANUAL_CAPTION' : 'AUTO_CAPTION', result.language);
            if (!transcript.segments.length)
                continue;
            if (transcript.rawText.length > options.maxTranscriptChars) {
                transcript.segments = truncateSegments(transcript.segments, options.maxTranscriptChars);
            }
            store.putTranscript(transcript);
            return { status: 'READY', metadata, transcript };
        }
        catch (error) {
            lastError = error;
            debugLog('youtube:ingest', `caption attempt failed for ${videoId}`, describeError(error));
        }
    }
    // Tooling or network failures are retryable on resume and must not be cached as "no transcript".
    if (lastError)
        return { status: 'PROCESSING_FAILED', metadata, error: describeError(lastError) };
    store.markNoTranscript(videoId);
    return { status: options.enableAsrFallback ? 'TRANSCRIPTION_REQUIRED' : 'NO_TRANSCRIPT', metadata };
}
function truncateSegments(segments, maxChars) {
    const out = [];
    let total = 0;
    for (const s of segments) {
        if (total + s.text.length > maxChars)
            break;
        out.push(s);
        total += s.text.length;
    }
    return out;
}
