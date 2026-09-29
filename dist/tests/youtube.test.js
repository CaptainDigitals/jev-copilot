import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chunkScreeningQuestions, videoScreeningQuestions } from '../src/jev/questions/youtube.js';
import { YouTubeResearchEngine } from '../src/youtube/engine.js';
import { ingestVideo, toMetadata } from '../src/youtube/ingest.js';
import { ResearchStore, withVideo } from '../src/youtube/job.js';
import { runPool } from '../src/youtube/pool.js';
import { renderReport } from '../src/youtube/report.js';
import { isVideoId, parseYouTubeUrl, resolveSources, sanitizeQuery, videoUrl } from '../src/youtube/resolver.js';
import { detectDuplicates, mapChunkScreenings, mapVideoScreening, selectChunksForDeepAnalysis } from '../src/youtube/screening.js';
import { chunkTranscript, formatTimestamp, normalizeText, parseJson3 } from '../src/youtube/transcript.js';
import { classify, YtDlp } from '../src/youtube/ytdlp.js';
import { fakeAnswers, isolateDataDir, testRuntime } from './helpers.js';
const ROUTING = { deep: 0.8, focused: 0.6, archive: 0.35, weights: { relevance: 0.3, technicalDepth: 0.2, actionability: 0.2, novelty: 0.15, evidenceDensity: 0.15, promotionPenalty: 0.2 } };
const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'aBcDeFgHiJk';
const ID_C = 'zYxWvUtSrQp';
function words(n, seed) {
    return Array.from({ length: n }, (_, i) => `${seed}${i % 37} token${i % 11}`).join(' ');
}
function transcript(videoId, seconds = 1200, seed = 'w') {
    const segments = Array.from({ length: seconds / 10 }, (_, i) => ({ startSeconds: i * 10, endSeconds: i * 10 + 10, text: words(30, `${seed}${i}`) }));
    return { videoId, source: 'MANUAL_CAPTION', language: 'en', segments, rawText: segments.map((s) => s.text).join(' '), retrievedAt: new Date().toISOString() };
}
describe('resolver', () => {
    it('parses the common YouTube URL shapes and rejects everything else', () => {
        assert.equal(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID_A}&t=42s`)?.kind, 'video');
        assert.equal(parseYouTubeUrl(`https://youtu.be/${ID_A}`)?.videoIds[0], ID_A);
        assert.equal(parseYouTubeUrl(`https://www.youtube.com/shorts/${ID_A}`)?.kind, 'video');
        assert.equal(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLabc1234567890')?.kind, 'playlist');
        assert.equal(parseYouTubeUrl('https://www.youtube.com/@SomeChannel/videos')?.kind, 'channel');
        assert.equal(parseYouTubeUrl('https://example.com/watch?v=' + ID_A), undefined);
        assert.equal(parseYouTubeUrl('javascript:alert(1)'), undefined);
        assert.ok(isVideoId(ID_A));
        assert.ok(!isVideoId('--dangerous'));
        assert.equal(videoUrl(ID_A, 61), `https://www.youtube.com/watch?v=${ID_A}&t=61s`);
    });
    it('turns free text into a sanitized search and never an option', () => {
        const [source] = resolveSources(['--exec rm -rf', 'FPV drone build 2026']);
        assert.equal(source?.kind, 'search');
        assert.ok(!source?.value.startsWith('-'));
        assert.ok(source?.value.includes('drone'));
        assert.ok(!sanitizeQuery('--flag').startsWith('-'));
    });
    it('rejects non-YouTube URLs and reads URL files', () => {
        assert.throws(() => resolveSources(['https://evil.example/payload']), /Not a supported YouTube URL/);
        const dir = mkdtempSync(join(tmpdir(), 'jev-yt-file-'));
        const file = join(dir, 'urls.txt');
        writeFileSync(file, `https://youtu.be/${ID_A}\n# comment\nhttps://www.youtube.com/watch?v=${ID_B}\n`, 'utf8');
        const sources = resolveSources([file]);
        assert.equal(sources[0]?.kind, 'file');
        assert.deepEqual(sources[0]?.videoIds, [ID_A, ID_B]);
        assert.throws(() => resolveSources([ID_A], { collection: 'bad name!' }), /Collection names/);
    });
});
describe('transcripts and chunking', () => {
    it('parses json3 caption events and normalizes text', () => {
        const events = [
            { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
            { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: '\n' }] },
            { tStartMs: 3500, dDurationMs: 2500, segs: [{ utf8: '[Music] this is  a test' }] },
            { tStartMs: 6000, segs: [] },
        ];
        const t = parseJson3(events, ID_A, 'AUTO_CAPTION', 'en');
        assert.equal(t.segments.length, 2);
        assert.equal(t.segments[0]?.text, 'Hello world');
        assert.equal(t.segments[1]?.startSeconds, 3.5);
        assert.ok(t.rawText.includes('[Music]'), 'raw text is preserved verbatim');
        assert.ok(!normalizeText(t.rawText).includes('[Music]'));
    });
    it('closes chunks at sentence ends once the target is reached', () => {
        const segments = Array.from({ length: 60 }, (_, i) => ({ startSeconds: i * 10, endSeconds: i * 10 + 10, text: `${words(30, `s${i}`)}${i % 3 === 2 ? '.' : ''}` }));
        const t = { videoId: ID_A, source: 'MANUAL_CAPTION', language: 'en', segments, rawText: '', retrievedAt: '' };
        const chunks = chunkTranscript(t, [], { targetTokens: 150, maxTokens: 900, minTokens: 50 });
        assert.ok(chunks.length >= 10);
        for (const c of chunks.slice(0, -1))
            assert.ok(c.text.endsWith('.'), `chunk ${c.chunkId} ends mid-sentence: ...${c.text.slice(-30)}`);
    });
    it('chunks by chapter and token budget with sequential ids and timestamps', () => {
        const t = transcript(ID_A, 2400);
        const chapters = [{ title: 'Intro', startSeconds: 0, endSeconds: 600 }, { title: 'Build', startSeconds: 600, endSeconds: 2400 }];
        const chunks = chunkTranscript(t, chapters, { targetTokens: 400, maxTokens: 600, minTokens: 50 });
        assert.ok(chunks.length > 3);
        assert.equal(chunks[0]?.chunkId, `${ID_A}:0000`);
        assert.equal(chunks[0]?.chapter, 'Intro');
        assert.ok(chunks.every((c) => c.tokenCount <= 600 && c.endSeconds > c.startSeconds));
        assert.ok(chunks.some((c) => c.chapter === 'Build'));
        for (let i = 1; i < chunks.length; i += 1)
            assert.ok((chunks[i]?.startSeconds ?? 0) >= (chunks[i - 1]?.startSeconds ?? 0));
        assert.equal(formatTimestamp(3725), '1:02:05');
        assert.equal(formatTimestamp(65), '1:05');
    });
});
describe('screening and routing policy', () => {
    it('routes high-value technical videos deep and promotional ones to archive', () => {
        const strong = fakeAnswers(videoScreeningQuestions, { relevance: 4, technical_depth: 3, actionability: 2, novelty: 2, evidence_density: 2, promotional_intensity: 0, content_type: 'build_log' });
        const deep = mapVideoScreening(strong, ROUTING);
        assert.equal(deep.route, 'deep');
        assert.ok(deep.researchValue >= 0.8);
        assert.ok(deep.reasonCodes.includes('ADVANCED'));
        const promo = fakeAnswers(videoScreeningQuestions, { relevance: 2, technical_depth: 0, actionability: 0, novelty: 0, evidence_density: 0, promotional_intensity: 2, content_type: 'marketing' });
        const archived = mapVideoScreening(promo, ROUTING);
        assert.equal(archived.route, 'archive');
        assert.ok(archived.reasonCodes.includes('MARKETING'));
        const irrelevant = fakeAnswers(videoScreeningQuestions, { relevance: 0, technical_depth: 3, actionability: 2, novelty: 2, evidence_density: 2 });
        assert.equal(mapVideoScreening(irrelevant, ROUTING).route, 'archive');
        assert.equal(mapVideoScreening(strong, ROUTING, ID_B).route, 'archive');
    });
    it('maps chunk answers by position and selects the important chunks', () => {
        const chunks = Array.from({ length: 4 }, (_, i) => ({ chunkId: `${ID_A}:000${i}`, videoId: ID_A, startSeconds: i * 100, endSeconds: i * 100 + 100, text: `chunk ${i}`, tokenCount: 50 }));
        const answers = fakeAnswers(chunkScreeningQuestions(4), { relevant_k0: 0.1, importance_k0: 0, relevant_k2: 0.95, importance_k2: 2, hardware_k2: 0.9, relevant_k3: 0.9, importance_k3: 1 });
        const screenings = mapChunkScreenings(chunks, answers);
        assert.equal(screenings.length, 4);
        assert.equal(screenings[2]?.importance, 2);
        assert.ok((screenings[2]?.containsHardware ?? 0) > 0.8);
        const focused = selectChunksForDeepAnalysis(chunks, screenings, 'focused', 2);
        assert.equal(focused[0]?.chunkId, `${ID_A}:0002`);
        assert.ok(!focused.some((c) => c.chunkId === `${ID_A}:0000`));
        assert.equal(selectChunksForDeepAnalysis(chunks, screenings, 'deep', 10).length, 2, 'chunks below the relevance floor (k0, k1) are dropped');
    });
    it('detects duplicates by title and content overlap, keeping the first as canonical', () => {
        const text = words(600, 'dup');
        const dupes = detectDuplicates([
            { videoId: ID_A, title: 'How to build a 5 inch FPV drone', channelId: 'c1', text },
            { videoId: ID_B, title: 'How to build a 5 inch FPV drone (reupload)', channelId: 'c2', text },
            { videoId: ID_C, title: 'Soldering tips', channelId: 'c3', text: words(600, 'other') },
        ]);
        assert.equal(dupes.get(ID_B), ID_A);
        assert.ok(!dupes.has(ID_A));
        assert.ok(!dupes.has(ID_C));
    });
});
describe('yt-dlp wrapper safety', () => {
    function recordingRunner(result = { stdout: '{}', code: 0 }) {
        const runner = (async (command, args) => {
            runner.calls.push([command, ...args]);
            return { stdout: result.stdout, stderr: result.stderr ?? '', code: result.code };
        });
        runner.calls = [];
        return runner;
    }
    it('never passes non-YouTube URLs, always terminates options with --, and never downloads media', async () => {
        const runner = recordingRunner({ stdout: JSON.stringify({ id: ID_A, title: 't' }), code: 0 });
        const yt = new YtDlp({ binary: 'yt-dlp', timeoutMs: 1000, runner });
        await yt.videoInfo(`https://youtu.be/${ID_A}`);
        await assert.rejects(yt.videoInfo('https://evil.example/x'), /non-YouTube/);
        await yt.search('--exec calc test query', 5);
        for (const call of runner.calls) {
            const sep = call.indexOf('--');
            assert.ok(sep > 0, 'options terminated with --');
            assert.ok(!call.includes('--exec'));
            assert.ok(call.includes('--skip-download') || call.includes('--flat-playlist'));
            assert.ok(!call.includes('--convert-subs'));
            assert.ok(call.includes('--ignore-config'));
        }
        const searchArg = runner.calls[1]?.at(-1) ?? '';
        assert.ok(searchArg.startsWith('ytsearch5:'));
        assert.ok(!searchArg.includes('--exec'));
    });
    it('classifies yt-dlp failures and redacts error text', async () => {
        assert.equal(classify('ERROR: Private video. Sign in'), 'PRIVATE');
        assert.equal(classify('ERROR: Video unavailable. This video has been removed'), 'DELETED');
        assert.equal(classify('HTTP Error 429: Too Many Requests'), 'RATE_LIMITED');
        assert.equal(classify('some random failure'), 'PROCESSING_FAILED');
        const runner = recordingRunner({ stdout: '', stderr: 'ERROR: Private video token=sk-or-v1-' + 'a'.repeat(40), code: 1 });
        const yt = new YtDlp({ binary: 'yt-dlp', timeoutMs: 1000, runner });
        await assert.rejects(yt.videoInfo(`https://youtu.be/${ID_A}`), (e) => e.message.includes('PRIVATE') && !e.message.includes('a'.repeat(40)));
    });
    it('does not mistake a failed caption fetch for a missing transcript', async () => {
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        const runner = async (_c, args) => {
            if (args.includes('-J'))
                return { stdout: JSON.stringify({ id: ID_A, title: 't', subtitles: {}, automatic_captions: { en: [{}] } }), stderr: '', code: 0 };
            return { stdout: '', stderr: 'ERROR: HTTP Error 429: Too Many Requests', code: 1 };
        };
        const result = await ingestVideo(ID_A, new YtDlp({ binary: 'yt-dlp', timeoutMs: 1000, runner }), store, { languages: ['en'], enableAsrFallback: false, maxTranscriptChars: 1000 });
        assert.equal(result.status, 'PROCESSING_FAILED');
        assert.match(result.error ?? '', /RATE_LIMITED/);
        assert.ok(!store.hasNoTranscriptMarker(ID_A), 'retryable failures are not cached as no-transcript');
        const clean = async (_c, args) => (args.includes('-J') ? { stdout: JSON.stringify({ id: ID_B, title: 't' }), stderr: '', code: 0 } : { stdout: '', stderr: '', code: 0 });
        const none = await ingestVideo(ID_B, new YtDlp({ binary: 'yt-dlp', timeoutMs: 1000, runner: clean }), store, { languages: ['en'], enableAsrFallback: false, maxTranscriptChars: 1000 });
        assert.equal(none.status, 'NO_TRANSCRIPT');
        assert.ok(store.hasNoTranscriptMarker(ID_B));
    });
    it('maps yt-dlp metadata defensively', () => {
        const meta = toMetadata({ id: ID_A, title: 'T', channel: 'C', channel_id: 'UC1', duration: 90, upload_date: '20260101', chapters: [{ title: 'x', start_time: 0, end_time: 30 }, { title: 'bad', start_time: 5, end_time: 5 }], subtitles: { en: [] }, tags: ['a', 3] });
        assert.equal(meta.publishedAt, '2026-01-01');
        assert.equal(meta.chapters.length, 1);
        assert.ok(meta.hasManualCaptions);
        assert.ok(!meta.hasAutoCaptions);
        assert.deepEqual(meta.tags, ['a']);
        assert.throws(() => toMetadata({ id: 'nope' }), /valid video id/);
    });
});
describe('pool and store', () => {
    it('runs a bounded pool and isolates failures', async () => {
        let active = 0;
        let peak = 0;
        const results = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active -= 1;
            if (n === 3)
                throw new Error('boom');
            return n * 2;
        });
        assert.equal(peak, 2);
        assert.equal(results.length, 5);
        assert.equal(results[2]?.error instanceof Error, true);
        assert.equal(results[4]?.result, 10);
    });
    it('persists jobs, caches videos across jobs, and manages collections', () => {
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        const job = store.createJob('q', [{ kind: 'video', value: videoUrl(ID_A), videoIds: [ID_A] }], { mode: 'standard', task: 'research', maxVideos: 10, top: 5, analyzeAll: false, dedupe: true, budgetUsd: 1, deepModel: 'claude-session' });
        assert.match(job.jobId, /^yt-\d{8}-[0-9a-f]{6}$/);
        const t = transcript(ID_A, 100);
        store.putTranscript(t);
        assert.equal(store.getTranscript(ID_A)?.segments.length, 10);
        store.saveJob(withVideo(job, { videoId: ID_A, status: 'READY' }));
        assert.equal(store.loadJob(job.jobId)?.videos[ID_A]?.status, 'READY');
        assert.equal(store.latestJobId(), job.jobId);
        store.markNoTranscript(ID_B);
        assert.ok(store.hasNoTranscriptMarker(ID_B));
        store.addToCollection('drones', [ID_A, ID_B], job.jobId);
        store.addToCollection('drones', [ID_B, ID_C], 'other');
        const c = store.loadCollection('drones');
        assert.deepEqual(c.videoIds, [ID_A, ID_B, ID_C]);
        assert.deepEqual(c.jobIds, [job.jobId, 'other']);
        assert.equal(store.loadJob('../escape'), undefined);
    });
});
/** Fake yt-dlp that serves three videos, one of them private; captions are written as json3 into cwd. */
function fakeYtDlp() {
    const meta = (id, title, channel, channelId) => ({ id, title, channel, channel_id: channelId, duration: 1200, upload_date: '20260301', description: 'desc', subtitles: { en: [{}] }, automatic_captions: {}, chapters: [{ title: 'Intro', start_time: 0, end_time: 300 }, { title: 'Build', start_time: 300, end_time: 1200 }], view_count: 10, tags: ['fpv'] });
    const seeds = { [ID_A]: 'alpha', [ID_B]: 'alpha', [ID_C]: 'gamma' };
    const runner = (async (command, args, options) => {
        runner.calls.push([command, ...args]);
        if (args.includes('--version'))
            return { stdout: '2026.08.19', stderr: '', code: 0 };
        const target = args.at(-1) ?? '';
        if (args.includes('--flat-playlist')) {
            return { stdout: JSON.stringify({ entries: [{ id: ID_A, title: 'FPV build A' }, { id: ID_B, title: 'FPV build A reupload' }, { id: ID_C, title: 'Private one' }] }), stderr: '', code: 0 };
        }
        const id = /v=([A-Za-z0-9_-]{11})/.exec(target)?.[1] ?? '';
        if (id === ID_C)
            return { stdout: '', stderr: 'ERROR: Private video. Sign in if you have been granted access', code: 1 };
        if (args.includes('-J'))
            return { stdout: JSON.stringify(meta(id, id === ID_A ? 'FPV build A' : 'FPV build A reupload', id === ID_A ? 'Chan1' : 'Chan2', id === ID_A ? 'c1' : 'c2')), stderr: '', code: 0 };
        if (args.includes('--write-subs') || args.includes('--write-auto-subs')) {
            const t = transcript(id, 1200, seeds[id] ?? 'x');
            const events = t.segments.map((s) => ({ tStartMs: s.startSeconds * 1000, dDurationMs: 10000, segs: [{ utf8: s.text }] }));
            if (options.cwd)
                writeFileSync(join(options.cwd, `${id}.en.json3`), JSON.stringify({ events }), 'utf8');
            return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '{}', stderr: '', code: 0 };
    });
    runner.calls = [];
    return runner;
}
describe('research engine end to end (mocked yt-dlp and JEV)', () => {
    it('discovers, ingests, chunks, screens, dedupes, bundles and reports; then resumes idempotently', async () => {
        const runtime = testRuntime('yt-engine', { overrides: { relevance: 4, technical_depth: 3, actionability: 2, novelty: 2, evidence_density: 2, promotional_intensity: 0, content_type: 'build_log' }, defaults: { noul: 0.9, score: 2 } }, { youtubeResearch: { ...loadYt(), chunk: { targetTokens: 400, maxTokens: 600, minTokens: 50 }, workers: { metadata: 2, transcripts: 2, jev: 2, deep: 1 } } });
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        const runner = fakeYtDlp();
        const progress = [];
        const engine = new YouTubeResearchEngine(runtime, { store, ytdlpRunner: runner, onProgress: (l) => progress.push(l) });
        const outcome = await engine.run({ inputs: ['https://www.youtube.com/playlist?list=PLtest1234567890'], question: 'How do I build a 5 inch FPV drone?', collection: 'fpv' });
        const { job } = outcome;
        assert.equal(job.state, 'COMPLETE');
        assert.equal(job.metrics.videosDiscovered, 3);
        assert.equal(job.videos[ID_C]?.status, 'PRIVATE');
        assert.equal(job.videos[ID_A]?.status, 'READY');
        assert.equal(job.videos[ID_A]?.screening?.route, 'deep');
        assert.equal(job.videos[ID_B]?.duplicateOf, ID_A, 'reupload is suppressed as a duplicate');
        assert.equal(job.videos[ID_B]?.screening?.route, 'archive');
        assert.ok(job.metrics.jevCalls >= 3);
        assert.ok(!outcome.overBudget);
        const bundle = store.getArtifact(job.jobId, 'bundle.md') ?? '';
        assert.ok(bundle.includes(`[${ID_A}@0:00](https://www.youtube.com/watch?v=${ID_A}&t=0s)`), 'bundle carries timestamp citations');
        assert.ok(bundle.includes('## Screening'));
        assert.ok(!bundle.includes('FPV build A reupload\n**['), 'duplicate video contributes no evidence');
        const report = store.getArtifact(job.jobId, 'report.md') ?? '';
        assert.ok(report.includes('# JEV Research: How do I build a 5 inch FPV drone?'));
        assert.ok(report.includes('duplicate of ' + ID_A));
        assert.ok(report.includes(`${ID_C}: PRIVATE`));
        assert.ok(JSON.parse(store.getArtifact(job.jobId, 'report.json') ?? '{}').videos.length === 3);
        assert.deepEqual(store.loadCollection('fpv').videoIds, [ID_A, ID_B, ID_C]);
        assert.ok(!runner.calls.some((c) => c.includes('-f') || c.includes('--format')), 'never downloads media');
        // Resume: nothing is re-fetched or re-screened.
        const callsBefore = runner.calls.length;
        const jevBefore = job.metrics.jevCalls;
        const again = await engine.resume(job.jobId, false);
        assert.equal(again.job.state, 'COMPLETE');
        assert.equal(again.job.metrics.jevCalls, jevBefore);
        assert.ok(runner.calls.length - callsBefore <= 1, 'resume issues at most an availability check');
        // Synthesis merge and follow-up ask.
        const { reportPath } = engine.refreshReport(job.jobId, '## Executive Summary\n\nSynth text [x@0:00](u)');
        assert.ok((store.getArtifact(job.jobId, 'report.md') ?? '').includes('Synth text'));
        assert.ok(reportPath.endsWith('report.md'));
        const ask = await engine.ask(job.jobId, 'which alpha0 token appears');
        assert.ok(ask.answers.length > 0);
        assert.equal(ask.jevCalls >= 1, true);
        const viaCollection = await engine.ask('fpv', 'alpha0 token');
        assert.ok(viaCollection.answers.length > 0);
        await assert.rejects(engine.ask('nothing-here', 'q'), /no job or collection/);
        assert.ok(progress.some((l) => l.startsWith('Videos discovered: 3')));
    });
    it('pauses over budget before spending JEV calls and continues on confirmation', async () => {
        const runtime = testRuntime('yt-budget', { defaults: { noul: 0.5, score: 2 } }, { youtubeResearch: { ...loadYt(), chunk: { targetTokens: 400, maxTokens: 600, minTokens: 50 }, budgetUsd: 0.0000001 } });
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        const engine = new YouTubeResearchEngine(runtime, { store, ytdlpRunner: fakeYtDlp() });
        const paused = await engine.run({ inputs: [ID_A], question: 'q' });
        assert.ok(paused.overBudget);
        assert.equal(paused.job.metrics.jevCalls, 0);
        assert.notEqual(paused.job.state, 'COMPLETE');
        const done = await engine.resume(paused.job.jobId, true);
        assert.equal(done.job.state, 'COMPLETE');
        assert.ok(done.job.metrics.jevCalls > 0);
    });
    it('resumes after a mid-screening failure without re-spending JEV calls on finished videos', async () => {
        let crashing = true;
        const runtime = testRuntime('yt-crash', {
            overrides: { relevance: 4, technical_depth: 3, actionability: 2, novelty: 2, evidence_density: 2, promotional_intensity: 0, content_type: 'build_log' },
            defaults: { noul: 0.9, score: 2 },
            onRequest: (body) => {
                if (crashing && JSON.stringify(body.state).includes('FPV build A reupload'))
                    throw new Error('simulated crash during screening');
            },
        }, { youtubeResearch: { ...loadYt(), chunk: { targetTokens: 400, maxTokens: 600, minTokens: 50 }, dedupe: false, workers: { metadata: 1, transcripts: 1, jev: 1, deep: 1 } } });
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        const engine = new YouTubeResearchEngine(runtime, { store, ytdlpRunner: fakeYtDlp() });
        const first = await engine.run({ inputs: [ID_A, ID_B], question: 'q' });
        assert.equal(first.job.videos[ID_A]?.screening?.route, 'deep');
        assert.equal(first.job.videos[ID_B]?.status, 'PROCESSING_FAILED');
        assert.equal(first.job.metrics.processingErrors, 1);
        const persisted = store.loadJob(first.job.jobId);
        assert.ok(persisted?.videos[ID_A]?.screening, 'finished video is persisted with its screening');
        assert.equal(persisted?.metrics.jevCalls, first.job.metrics.jevCalls);
        crashing = false;
        const before = runtime.stats().calls;
        const second = await engine.resume(first.job.jobId, false);
        assert.equal(second.job.videos[ID_B]?.status, 'READY');
        assert.ok(second.job.videos[ID_B]?.screening, 'failed video is retried on resume');
        assert.deepEqual(second.job.videos[ID_A]?.chunkScreenings, first.job.videos[ID_A]?.chunkScreenings, 'finished video is not re-screened');
        const spentOnResume = runtime.stats().calls - before;
        assert.equal(spentOnResume, second.job.metrics.jevCalls - first.job.metrics.jevCalls);
        assert.equal(spentOnResume, 1 + Math.ceil((second.job.videos[ID_B]?.chunkCount ?? 0) / 4));
    });
    it('fails the job cleanly when yt-dlp is missing', async () => {
        const runtime = testRuntime('yt-missing');
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        const runner = async () => ({ stdout: '', stderr: 'yt-dlp: not found', code: 127 });
        const engine = new YouTubeResearchEngine(runtime, { store, ytdlpRunner: runner });
        await assert.rejects(engine.run({ inputs: [ID_A] }), /yt-dlp not found/);
    });
    it('renders a single-video analysis title and an honest synthesis placeholder', () => {
        const store = new ResearchStore(join(isolateDataDir(), 'research'));
        let job = store.createJob('q', [], { mode: 'deep', task: 'analyze', maxVideos: 1, top: 1, analyzeAll: true, dedupe: false, budgetUsd: 1, deepModel: 'claude-session' });
        job = withVideo(job, { videoId: ID_A, status: 'READY', screening: { relevance: 4, contentType: 'tutorial', contentTypeConfidence: 0.9, technicalDepth: 3, actionability: 2, novelty: 1, promotionalIntensity: 0, evidenceDensity: 2, deepAnalysisRecommended: 0.9, confidence: 0.9, researchValue: 0.9, route: 'deep', reasonCodes: ['ADVANCED'] } });
        const metadata = new Map([[ID_A, toMetadata({ id: ID_A, title: 'My Video', channel: 'C', duration: 60 })]]);
        const md = renderReport({ job, metadata, analyses: new Map() });
        assert.ok(md.startsWith('# Video analysis: My Video'));
        assert.ok(md.includes('No headless deep model was configured'));
    });
});
function loadYt() {
    return testRuntime('yt-cfg').config.youtubeResearch;
}
