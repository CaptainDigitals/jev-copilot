import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir, ensureDir, safeId } from '../core/paths.js';
/**
 * File-backed store for research jobs, the cross-job video cache and named collections (PRD §29, §39, §40).
 * Layout under the plugin data directory:
 *   research/jobs/<jobId>/job.json, videos/<id>.{chunks,screening}.json, <id>.deep.md, bundle.md, report.{md,json}
 *   research/cache/videos/<id>/{meta,transcript}.json   (reused across jobs)
 *   research/collections/<name>.json
 */
export class ResearchStore {
    root;
    constructor(root = join(dataDir(), 'research')) {
        this.root = root;
        ensureDir(join(root, 'jobs'));
        ensureDir(join(root, 'cache', 'videos'));
        ensureDir(join(root, 'collections'));
    }
    jobDir(jobId) {
        const dir = join(this.root, 'jobs', safeId(jobId));
        ensureDir(join(dir, 'videos'));
        return dir;
    }
    newJobId() {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        return `yt-${stamp}-${randomBytes(3).toString('hex')}`;
    }
    createJob(question, sources, options) {
        const now = new Date().toISOString();
        const job = { jobId: this.newJobId(), question, sources, options, state: 'CREATED', createdAt: now, updatedAt: now, videoOrder: [], videos: {}, metrics: emptyMetrics() };
        return this.saveJob(job);
    }
    saveJob(job) {
        const next = { ...job, updatedAt: new Date().toISOString() };
        writeFileSync(join(this.jobDir(job.jobId), 'job.json'), JSON.stringify(next, null, 2), 'utf8');
        return next;
    }
    loadJob(jobId) {
        const file = join(this.root, 'jobs', safeId(jobId), 'job.json');
        if (!existsSync(file))
            return undefined;
        try {
            return JSON.parse(readFileSync(file, 'utf8'));
        }
        catch {
            return undefined;
        }
    }
    listJobs(limit = 20) {
        const dir = join(this.root, 'jobs');
        return readdirSync(dir)
            .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit)
            .map((e) => this.loadJob(e.name))
            .filter((j) => !!j);
    }
    latestJobId() {
        return this.listJobs(1)[0]?.jobId;
    }
    /* Per-video cache, shared across jobs. */
    videoCacheDir(videoId) {
        const dir = join(this.root, 'cache', 'videos', safeId(videoId));
        ensureDir(dir);
        return dir;
    }
    getMetadata(videoId) {
        return this.readJson(join(this.videoCacheDir(videoId), 'meta.json'));
    }
    putMetadata(meta) {
        writeFileSync(join(this.videoCacheDir(meta.videoId), 'meta.json'), JSON.stringify(meta), 'utf8');
    }
    getTranscript(videoId) {
        return this.readJson(join(this.videoCacheDir(videoId), 'transcript.json'));
    }
    putTranscript(transcript) {
        writeFileSync(join(this.videoCacheDir(transcript.videoId), 'transcript.json'), JSON.stringify(transcript), 'utf8');
    }
    /** Records that a transcript lookup found nothing so the next job does not retry immediately. */
    markNoTranscript(videoId) {
        writeFileSync(join(this.videoCacheDir(videoId), 'no-transcript.json'), JSON.stringify({ at: new Date().toISOString() }), 'utf8');
    }
    hasNoTranscriptMarker(videoId, maxAgeHours = 72) {
        const file = join(this.videoCacheDir(videoId), 'no-transcript.json');
        if (!existsSync(file))
            return false;
        return Date.now() - statSync(file).mtimeMs < maxAgeHours * 3600 * 1000;
    }
    /* Per-job artifacts. */
    putChunks(jobId, videoId, chunks) {
        writeFileSync(join(this.jobDir(jobId), 'videos', `${safeId(videoId)}.chunks.json`), JSON.stringify(chunks), 'utf8');
    }
    getChunks(jobId, videoId) {
        return this.readJson(join(this.jobDir(jobId), 'videos', `${safeId(videoId)}.chunks.json`)) ?? [];
    }
    putChunkScreenings(jobId, videoId, screenings) {
        writeFileSync(join(this.jobDir(jobId), 'videos', `${safeId(videoId)}.screening.json`), JSON.stringify(screenings), 'utf8');
    }
    getChunkScreenings(jobId, videoId) {
        return this.readJson(join(this.jobDir(jobId), 'videos', `${safeId(videoId)}.screening.json`)) ?? [];
    }
    putDeepAnalysis(jobId, videoId, markdown) {
        writeFileSync(join(this.jobDir(jobId), 'videos', `${safeId(videoId)}.deep.md`), markdown, 'utf8');
    }
    getDeepAnalysis(jobId, videoId) {
        const file = join(this.jobDir(jobId), 'videos', `${safeId(videoId)}.deep.md`);
        return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    }
    putArtifact(jobId, name, content) {
        const file = join(this.jobDir(jobId), name);
        writeFileSync(file, content, 'utf8');
        return file;
    }
    getArtifact(jobId, name) {
        const file = join(this.jobDir(jobId), name);
        return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    }
    /* Collections. */
    loadCollection(name) {
        const file = join(this.root, 'collections', `${safeId(name)}.json`);
        return this.readJson(file) ?? { name, videoIds: [], jobIds: [], updatedAt: new Date().toISOString() };
    }
    addToCollection(name, videoIds, jobId) {
        const current = this.loadCollection(name);
        const merged = { name, videoIds: [...new Set([...current.videoIds, ...videoIds])], jobIds: [...new Set([...current.jobIds, jobId])], updatedAt: new Date().toISOString() };
        mkdirSync(join(this.root, 'collections'), { recursive: true });
        writeFileSync(join(this.root, 'collections', `${safeId(name)}.json`), JSON.stringify(merged, null, 2), 'utf8');
    }
    readJson(file) {
        try {
            return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
        }
        catch {
            return undefined;
        }
    }
}
export function emptyMetrics() {
    return { videosDiscovered: 0, videosProcessed: 0, videosRejected: 0, transcriptTokens: 0, jevCalls: 0, deepModelCalls: 0, visionCalls: 0, duplicateClusters: 0, claimsExtracted: 0, processingErrors: 0, estimatedCostUsd: 0 };
}
/** Returns a new job with one video record replaced or added. */
export function withVideo(job, record) {
    const videoOrder = job.videoOrder.includes(record.videoId) ? job.videoOrder : [...job.videoOrder, record.videoId];
    return { ...job, videoOrder, videos: { ...job.videos, [record.videoId]: record } };
}
export function withState(job, state) {
    return { ...job, state };
}
export function withMetrics(job, patch) {
    return { ...job, metrics: { ...job.metrics, ...patch } };
}
export function isTerminalStatus(status) {
    return status === 'PRIVATE' || status === 'DELETED' || status === 'UNAVAILABLE' || status === 'NO_TRANSCRIPT' || status === 'TRANSCRIPTION_REQUIRED';
}
