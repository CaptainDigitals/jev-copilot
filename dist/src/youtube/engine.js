import { debugLog, describeError } from '../core/logger.js';
import { ASK_SET, ASK_VERSION, CHUNK_SCREENING_SET, CHUNK_SCREENING_VERSION, VIDEO_SCREENING_SET, VIDEO_SCREENING_VERSION, askQuestions, chunkScreeningQuestions, videoScreeningQuestions } from '../jev/questions/youtube.js';
import { score } from '../jev/schema.js';
import { redactText } from '../security/redact.js';
import { ChatClient, deepAnalysisPrompt, renderVideoEvidence, synthesisPrompt } from './deep.js';
import { discoverVideos, ingestVideo } from './ingest.js';
import { ResearchStore, isTerminalStatus, withMetrics, withState, withVideo } from './job.js';
import { runPool } from './pool.js';
import { corpusSummary, renderJson, renderReport, screeningTable } from './report.js';
import { resolveSources } from './resolver.js';
import { detectDuplicates, mapChunkScreenings, mapVideoScreening, selectChunksForDeepAnalysis } from './screening.js';
import { chunkTranscript, formatTimestamp } from './transcript.js';
import { UNTRUSTED_NOTICE } from './untrusted.js';
import { YtDlp } from './ytdlp.js';
/**
 * Orchestrates a research job through its stages (PRD §37). Each stage persists per-video state
 * so a job can be resumed, and one failing video never fails the job.
 */
/** Pre-ingestion planning figure: a typical 15-20 minute captioned video is ~3k words. */
const ASSUMED_TOKENS_PER_VIDEO = 4000;
export class YouTubeResearchEngine {
    runtime;
    deps;
    store;
    ytdlp;
    cfg;
    progress;
    constructor(runtime, deps = {}) {
        this.runtime = runtime;
        this.deps = deps;
        this.cfg = runtime.config.youtubeResearch;
        this.store = deps.store ?? new ResearchStore();
        this.ytdlp = new YtDlp({ binary: this.cfg.ytDlpPath, timeoutMs: this.cfg.ytDlpTimeoutMs, ...(deps.ytdlpRunner ? { runner: deps.ytdlpRunner } : {}) });
        this.progress = deps.onProgress ?? (() => undefined);
    }
    options(partial) {
        return {
            mode: partial.mode ?? 'standard',
            task: partial.task ?? 'research',
            maxVideos: Math.min(500, Math.max(1, partial.maxVideos ?? this.cfg.maxVideos)),
            top: Math.max(1, partial.top ?? this.cfg.maxDeepVideos),
            analyzeAll: partial.analyzeAll ?? false,
            dedupe: partial.dedupe ?? this.cfg.dedupe,
            budgetUsd: partial.budgetUsd ?? this.cfg.budgetUsd,
            deepModel: partial.deepModel ?? this.cfg.deepModel,
            ...(partial.collection ? { collection: partial.collection } : {}),
        };
    }
    /** Creates, runs and (unless over budget without confirmation) completes a job. */
    async run(start) {
        const availability = await this.ytdlp.available();
        if (!availability.ok)
            throw new Error(availability.detail ?? 'yt-dlp unavailable');
        const sources = resolveSources(start.inputs, start.collection ? { collection: start.collection } : {});
        const question = (start.question ?? (sources.find((s) => s.kind === 'search')?.value ?? `Analyze: ${start.inputs.join(', ')}`)).slice(0, 2000);
        const options = this.options(start);
        let job = this.store.createJob(question, sources, options);
        return this.resume(job.jobId, start.confirmOverBudget ?? false);
    }
    /** Resumes a job from its persisted state; completed per-video work is skipped. */
    async resume(jobId, confirmOverBudget) {
        let job = this.store.loadJob(jobId);
        if (!job)
            throw new Error(`unknown job ${jobId}`);
        try {
            job = await this.discover(job);
            // Cheap gate before any transcript is fetched: a huge playlist must not tie up yt-dlp for minutes
            // when the budget could never cover screening it.
            const preview = this.estimate(job, ASSUMED_TOKENS_PER_VIDEO);
            if (job.options.budgetUsd > 0 && preview.totalCostUsd > job.options.budgetUsd && !confirmOverBudget) {
                job = this.store.saveJob(withMetrics(job, { estimatedCostUsd: preview.totalCostUsd }));
                return { job, estimate: preview, overBudget: true };
            }
            job = await this.ingest(job);
            job = await this.chunk(job);
            const estimate = this.estimate(job);
            const overBudget = job.options.budgetUsd > 0 && estimate.totalCostUsd > job.options.budgetUsd;
            if (overBudget && !confirmOverBudget) {
                job = this.store.saveJob(withMetrics(job, { estimatedCostUsd: estimate.totalCostUsd }));
                return { job, estimate, overBudget: true };
            }
            job = await this.screen(job);
            job = this.dedupe(job);
            job = await this.analyze(job);
            const artifacts = await this.synthesize(job);
            job = this.store.saveJob(withState({ ...job, ...artifacts }, 'COMPLETE'));
            if (job.options.collection)
                this.store.addToCollection(job.options.collection, job.videoOrder, job.jobId);
            return { job, estimate, overBudget: false, ...(artifacts.reportPath ? { reportPath: artifacts.reportPath } : {}), ...(artifacts.bundlePath ? { bundlePath: artifacts.bundlePath } : {}) };
        }
        catch (error) {
            this.store.saveJob(withState({ ...job, error: describeError(error) }, 'FAILED'));
            throw error;
        }
    }
    async discover(job) {
        if (job.videoOrder.length && job.state !== 'CREATED')
            return job;
        job = this.store.saveJob(withState(job, 'DISCOVERING'));
        const found = await discoverVideos(job.sources, this.ytdlp, this.store, job.options.maxVideos);
        for (const v of found)
            job = withVideo(job, { videoId: v.videoId, status: 'PENDING', ...(v.title ? { title: v.title } : {}) });
        this.progress(`Videos discovered: ${found.length}`);
        return this.store.saveJob(withMetrics(job, { videosDiscovered: found.length }));
    }
    async ingest(job) {
        job = this.store.saveJob(withState(job, 'INGESTING'));
        const pending = job.videoOrder.filter((id) => job.videos[id]?.status === 'PENDING' || job.videos[id]?.status === 'PROCESSING_FAILED');
        let done = 0;
        let errors = job.metrics.processingErrors;
        // Each video is persisted as soon as it finishes so an interrupted job resumes without refetching.
        await runPool(pending, this.cfg.workers.transcripts, async (videoId) => {
            const current = job.videos[videoId] ?? { videoId, status: 'PENDING' };
            let record;
            try {
                const result = await ingestVideo(videoId, this.ytdlp, this.store, { languages: this.cfg.languages, enableAsrFallback: this.cfg.enableAsrFallback, maxTranscriptChars: this.cfg.maxTranscriptChars });
                record = { ...current, status: result.status };
                if (result.metadata) {
                    record.title = result.metadata.title;
                    record.channelName = result.metadata.channelName;
                    record.durationSeconds = result.metadata.durationSeconds;
                }
                if (result.transcript) {
                    record.transcriptSource = result.transcript.source;
                    record.transcriptChars = result.transcript.rawText.length;
                }
                if (result.error)
                    record.error = result.error;
                if (result.status === 'PROCESSING_FAILED')
                    errors += 1;
            }
            catch (error) {
                errors += 1;
                record = { ...current, status: 'PROCESSING_FAILED', error: describeError(error) };
            }
            done += 1;
            this.progress(`Ingest ${done}/${pending.length}: ${videoId} ${record.status}`);
            job = this.store.saveJob(withVideo(job, record));
        });
        const rejected = job.videoOrder.filter((id) => isTerminalStatus(job.videos[id]?.status ?? 'PENDING') || job.videos[id]?.status === 'PROCESSING_FAILED').length;
        return this.store.saveJob(withMetrics(job, { processingErrors: errors, videosRejected: rejected }));
    }
    async chunk(job) {
        job = this.store.saveJob(withState(job, 'CHUNKING'));
        let tokens = 0;
        for (const videoId of job.videoOrder) {
            const record = job.videos[videoId];
            if (!record || record.status !== 'READY')
                continue;
            let chunks = this.store.getChunks(job.jobId, videoId);
            if (!chunks.length) {
                const transcript = this.store.getTranscript(videoId);
                const meta = this.store.getMetadata(videoId);
                if (!transcript)
                    continue;
                chunks = chunkTranscript(transcript, meta?.chapters ?? [], this.cfg.chunk);
                this.store.putChunks(job.jobId, videoId, chunks);
            }
            tokens += chunks.reduce((s, c) => s + c.tokenCount, 0);
            job = withVideo(job, { ...record, chunkCount: chunks.length });
        }
        return this.store.saveJob(withMetrics(job, { transcriptTokens: tokens }));
    }
    /**
     * Cost estimate. Before ingestion (`assumedTokensPerVideo` given) every discovered video counts with
     * an assumed transcript size; afterwards only videos with transcripts and their real token counts.
     */
    estimate(job, assumedTokensPerVideo) {
        const ready = assumedTokensPerVideo ? job.videoOrder.filter((id) => !isTerminalStatus(job.videos[id]?.status ?? 'PENDING')) : job.videoOrder.filter((id) => job.videos[id]?.status === 'READY');
        const transcriptTokens = assumedTokensPerVideo ? ready.length * assumedTokensPerVideo : job.metrics.transcriptTokens;
        const chunks = assumedTokensPerVideo ? Math.ceil(transcriptTokens / Math.max(1, this.cfg.chunk.targetTokens)) : ready.reduce((s, id) => s + (job.videos[id]?.chunkCount ?? 0), 0);
        const perRequest = Math.max(1, this.cfg.chunksPerJevRequest);
        // Chunk batches are per video, so the call count is the sum of per-video ceilings.
        const jevCalls = assumedTokensPerVideo ? ready.length + Math.ceil(chunks / perRequest) : ready.reduce((s, id) => s + 1 + Math.ceil((job.videos[id]?.chunkCount ?? 0) / perRequest), 0);
        const jevTokens = transcriptTokens + ready.length * 800;
        const jevCostUsd = (jevTokens * this.runtime.config.pricing.inputUsdPerMillion) / 1_000_000;
        const deepCandidates = job.options.analyzeAll ? ready.length : Math.min(job.options.top, Math.ceil(ready.length * 0.3));
        const deepInputTokens = deepCandidates * Math.min(this.cfg.deepMaxInputChars / 4, this.cfg.maxDeepChunksPerVideo * this.cfg.chunk.targetTokens);
        const headless = job.options.deepModel !== 'claude-session';
        // Without published pricing for arbitrary chat models, assume a conservative $5/M input for the estimate.
        const deepCostUsd = headless ? (deepInputTokens * 5) / 1_000_000 : null;
        return { videos: ready.length, transcriptTokens, jevCalls, jevCostUsd, deepCandidates, deepInputTokens, deepCostUsd, totalCostUsd: jevCostUsd + (deepCostUsd ?? 0), isEstimate: true };
    }
    async screen(job) {
        job = this.store.saveJob(withState(job, 'SCREENING'));
        const ready = job.videoOrder.filter((id) => job.videos[id]?.status === 'READY' && !job.videos[id]?.screening);
        let done = 0;
        let calls = job.metrics.jevCalls;
        let spent = job.metrics.estimatedCostUsd;
        let errors = job.metrics.processingErrors;
        await runPool(ready, this.cfg.workers.jev, async (videoId) => {
            const current = job.videos[videoId];
            if (!current)
                return;
            try {
                const meta = this.store.getMetadata(videoId);
                const chunks = this.store.getChunks(job.jobId, videoId);
                if (!meta || !chunks.length)
                    throw new Error('missing metadata or chunks');
                const excerpt = chunks.slice(0, 3).map((c) => c.text).join(' ').slice(0, 6000);
                const state = { question: job.question, video: { title: meta.title, channel: meta.channelName, description: redactText(meta.description).slice(0, 1500), durationSeconds: meta.durationSeconds, chapters: meta.chapters.map((c) => c.title).slice(0, 40), tags: meta.tags.slice(0, 20), views: meta.views }, transcriptExcerpt: redactText(excerpt) };
                const video = await this.runtime.decide(VIDEO_SCREENING_SET, VIDEO_SCREENING_VERSION, state, videoScreeningQuestions, { optional: false });
                const screening = mapVideoScreening(video.answers, this.cfg.routing);
                let jev = 1;
                let cost = video.meta.costUsd;
                let chunkScreenings = [];
                if (screening.route !== 'archive' || job.options.analyzeAll) {
                    const batchSize = Math.max(1, this.cfg.chunksPerJevRequest);
                    for (let i = 0; i < chunks.length; i += batchSize) {
                        const batch = chunks.slice(i, i + batchSize);
                        const batchState = { question: job.question, chunks: batch.map((c) => ({ id: c.chunkId, videoTitle: meta.title, chapter: c.chapter ?? null, start: formatTimestamp(c.startSeconds), end: formatTimestamp(c.endSeconds), text: redactText(c.text) })) };
                        const r = await this.runtime.decide(CHUNK_SCREENING_SET, CHUNK_SCREENING_VERSION, batchState, chunkScreeningQuestions(batch.length), { optional: false });
                        jev += 1;
                        cost += r.meta.costUsd;
                        chunkScreenings = [...chunkScreenings, ...mapChunkScreenings(batch, r.answers)];
                    }
                    this.store.putChunkScreenings(job.jobId, videoId, chunkScreenings);
                }
                calls += jev;
                spent += cost;
                done += 1;
                this.progress(`Screening ${done}/${ready.length}: ${videoId} → ${screening.route} (${screening.researchValue})`);
                // Persist immediately (with the running call count) so a crash never re-spends this video's JEV calls.
                job = this.store.saveJob(withMetrics(withVideo(job, { ...(job.videos[videoId] ?? current), screening, chunkScreenings }), { jevCalls: calls, estimatedCostUsd: Number(spent.toFixed(6)) }));
            }
            catch (error) {
                errors += 1;
                job = this.store.saveJob(withVideo(job, { ...(job.videos[videoId] ?? current), status: 'PROCESSING_FAILED', error: describeError(error) }));
            }
        });
        return this.store.saveJob(withMetrics(job, { jevCalls: calls, estimatedCostUsd: Number(spent.toFixed(6)), processingErrors: errors, videosProcessed: job.videoOrder.filter((id) => job.videos[id]?.screening).length }));
    }
    dedupe(job) {
        if (!job.options.dedupe)
            return job;
        job = withState(job, 'DEDUPLICATING');
        const candidates = job.videoOrder
            .filter((id) => job.videos[id]?.screening)
            .map((id) => {
            const meta = this.store.getMetadata(id);
            return { videoId: id, title: meta?.title ?? '', channelId: meta?.channelId ?? '', text: this.store.getChunks(job.jobId, id).map((c) => c.text).join(' ') };
        });
        const dupes = detectDuplicates(candidates);
        for (const [dup, canonical] of dupes) {
            const record = job.videos[dup];
            if (!record?.screening)
                continue;
            const penalized = { ...record.screening, researchValue: Number(Math.max(0, record.screening.researchValue - 0.5).toFixed(3)), route: 'archive', reasonCodes: [...record.screening.reasonCodes, 'DUPLICATE'] };
            job = withVideo(job, { ...record, duplicateOf: canonical, screening: penalized });
        }
        if (dupes.size)
            this.progress(`Deduplication: ${dupes.size} duplicates suppressed`);
        return this.store.saveJob(withMetrics(job, { duplicateClusters: new Set(dupes.values()).size }));
    }
    /** Which videos get deep treatment: routed deep/focused, best first, capped by `top` unless analyzeAll. */
    deepCandidates(job) {
        const routed = job.videoOrder
            .map((id) => job.videos[id])
            .filter((v) => !!v?.screening && v.status === 'READY' && !v.duplicateOf)
            .filter((v) => job.options.analyzeAll || v.screening?.route === 'deep' || v.screening?.route === 'focused')
            .sort((a, b) => (b.screening?.researchValue ?? 0) - (a.screening?.researchValue ?? 0));
        return job.options.analyzeAll ? routed : routed.slice(0, job.options.top);
    }
    deepInput(job, record) {
        const metadata = this.store.getMetadata(record.videoId);
        const chunks = this.store.getChunks(job.jobId, record.videoId);
        if (!metadata || !record.screening || !chunks.length)
            return undefined;
        const screenings = record.chunkScreenings ?? this.store.getChunkScreenings(job.jobId, record.videoId);
        const selected = screenings.length ? selectChunksForDeepAnalysis(chunks, screenings, job.options.analyzeAll ? 'deep' : record.screening.route, this.cfg.maxDeepChunksPerVideo) : chunks.slice(0, this.cfg.maxDeepChunksPerVideo);
        return { metadata, screening: record.screening, chunks: selected, screenings };
    }
    async analyze(job) {
        job = this.store.saveJob(withState(job, 'ANALYZING'));
        if (job.options.deepModel === 'claude-session')
            return job;
        const client = new ChatClient({ apiKey: this.runtime.config.apiKey, model: job.options.deepModel, timeoutMs: this.cfg.deepTimeoutMs, maxOutputTokens: this.cfg.deepMaxOutputTokens, ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}) });
        const targets = this.deepCandidates(job).filter((v) => !v.deepAnalysisDone);
        let done = 0;
        let calls = job.metrics.deepModelCalls;
        let cost = job.metrics.estimatedCostUsd;
        let errors = job.metrics.processingErrors;
        await runPool(targets, this.cfg.workers.deep, async (record) => {
            try {
                const input = this.deepInput(job, record);
                if (!input)
                    throw new Error('no evidence for deep analysis');
                const prompt = deepAnalysisPrompt(job.question, job.options.task, renderVideoEvidence(input, this.cfg.deepMaxInputChars));
                const r = await client.complete(prompt.system, prompt.user);
                this.store.putDeepAnalysis(job.jobId, record.videoId, r.text);
                calls += 1;
                cost += r.usage.costUsd ?? 0;
                done += 1;
                this.progress(`Deep analysis ${done}/${targets.length}: ${record.videoId}`);
                job = this.store.saveJob(withMetrics(withVideo(job, { ...(job.videos[record.videoId] ?? record), deepAnalysisDone: true }), { deepModelCalls: calls, estimatedCostUsd: Number(cost.toFixed(6)) }));
            }
            catch (error) {
                // A failed deep analysis is visible in the record and the metrics; the video keeps its screening.
                errors += 1;
                debugLog('youtube:deep', `deep analysis failed for ${record.videoId}`, describeError(error));
                job = this.store.saveJob(withVideo(job, { ...(job.videos[record.videoId] ?? record), error: `deep analysis failed: ${describeError(error)}` }));
            }
        });
        return this.store.saveJob(withMetrics(job, { deepModelCalls: calls, estimatedCostUsd: Number(cost.toFixed(6)), processingErrors: errors }));
    }
    /** Writes the evidence bundle, optional synthesis and the report; returns artifact paths. */
    async synthesize(job) {
        job = this.store.saveJob(withState(job, 'SYNTHESIZING'));
        const metadata = new Map();
        for (const id of job.videoOrder) {
            const m = this.store.getMetadata(id);
            if (m)
                metadata.set(id, m);
        }
        const bundlePath = this.store.putArtifact(job.jobId, 'bundle.md', this.renderBundle(job, metadata));
        const analyses = new Map();
        for (const v of this.deepCandidates(job)) {
            const a = this.store.getDeepAnalysis(job.jobId, v.videoId);
            if (a)
                analyses.set(v.videoId, a);
        }
        let synthesis;
        if (job.options.deepModel !== 'claude-session' && analyses.size) {
            try {
                const client = new ChatClient({ apiKey: this.runtime.config.apiKey, model: job.options.deepModel, timeoutMs: this.cfg.deepTimeoutMs * 2, maxOutputTokens: this.cfg.deepMaxOutputTokens * 2, ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}) });
                const inputs = [...analyses.entries()].map(([id, analysis]) => ({ metadata: metadata.get(id), analysis })).filter((x) => x.metadata);
                const prompt = synthesisPrompt(job.question, job.options.task, inputs, corpusSummary(job));
                synthesis = (await client.complete(prompt.system, prompt.user.slice(0, this.cfg.deepMaxInputChars * 2))).text;
                this.store.putArtifact(job.jobId, 'synthesis.md', synthesis);
            }
            catch (error) {
                debugLog('youtube:synthesis', 'synthesis failed', describeError(error));
            }
        }
        else {
            synthesis = this.store.getArtifact(job.jobId, 'synthesis.md');
        }
        const inputs = { job: { ...job, bundlePath }, metadata, analyses, ...(synthesis ? { synthesis } : {}) };
        const reportPath = this.store.putArtifact(job.jobId, 'report.md', renderReport(inputs));
        this.store.putArtifact(job.jobId, 'report.json', renderJson(inputs));
        return { bundlePath, reportPath };
    }
    /** The cited evidence bundle Claude reads when it is the deep model (PRD §21, §31). */
    renderBundle(job, metadata) {
        const candidates = this.deepCandidates(job);
        const parts = [
            `# Evidence bundle · ${job.jobId}`,
            '',
            UNTRUSTED_NOTICE,
            '',
            `Research question: ${job.question}`,
            `Task: ${job.options.task} · Mode: ${job.options.mode}`,
            '',
            corpusSummary(job),
            '',
            '## Screening',
            '',
            screeningTable(job, metadata),
            '',
            `## Routed evidence (${candidates.length} videos, best first)`,
            '',
        ];
        let used = parts.join('\n').length;
        const cap = this.cfg.deepMaxInputChars * Math.max(2, Math.min(8, candidates.length));
        for (const record of candidates) {
            const input = this.deepInput(job, record);
            if (!input)
                continue;
            const block = renderVideoEvidence(input, this.cfg.deepMaxInputChars);
            if (used + block.length > cap) {
                parts.push(`_(further videos omitted by bundle size cap; use jev_youtube_evidence for ${record.videoId} and later)_`);
                break;
            }
            parts.push(block, '');
            used += block.length;
        }
        return parts.join('\n');
    }
    /** Re-renders report.md, merging a synthesis written by Claude (saved as synthesis.md). */
    refreshReport(jobId, synthesis) {
        const job = this.store.loadJob(jobId);
        if (!job)
            throw new Error(`unknown job ${jobId}`);
        if (synthesis)
            this.store.putArtifact(jobId, 'synthesis.md', synthesis);
        const metadata = new Map();
        for (const id of job.videoOrder) {
            const m = this.store.getMetadata(id);
            if (m)
                metadata.set(id, m);
        }
        const analyses = new Map();
        for (const id of job.videoOrder) {
            const a = this.store.getDeepAnalysis(jobId, id);
            if (a)
                analyses.set(id, a);
        }
        const stored = this.store.getArtifact(jobId, 'synthesis.md');
        const inputs = { job, metadata, analyses, ...(stored ? { synthesis: stored } : {}) };
        return { reportPath: this.store.putArtifact(jobId, 'report.md', renderReport(inputs)), jsonPath: this.store.putArtifact(jobId, 'report.json', renderJson(inputs)) };
    }
    /** Evidence for one video of a job, for Claude to pull on demand. */
    evidence(jobId, videoId) {
        const job = this.store.loadJob(jobId);
        const record = job?.videos[videoId];
        if (!job || !record)
            return undefined;
        const input = this.deepInput(job, record);
        return input ? renderVideoEvidence(input, this.cfg.deepMaxInputChars) : undefined;
    }
    /** Follow-up question over a completed job or collection (PRD §30): keyword prefilter, then JEV ranking. */
    async ask(target, question, limit = 8) {
        const job = this.store.loadJob(target);
        const jobIds = job ? [job.jobId] : this.store.loadCollection(target).jobIds;
        if (!jobIds.length)
            throw new Error(`no job or collection named ${target}`);
        const keywords = question.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
        const pool = [];
        for (const id of jobIds) {
            const j = this.store.loadJob(id);
            if (!j)
                continue;
            for (const videoId of j.videoOrder) {
                const title = this.store.getMetadata(videoId)?.title ?? videoId;
                for (const chunk of this.store.getChunks(id, videoId)) {
                    const text = chunk.text.toLowerCase();
                    const hits = keywords.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
                    if (hits > 0)
                        pool.push({ chunk, hits, title });
                }
            }
        }
        const shortlist = pool.sort((a, b) => b.hits - a.hits).slice(0, 24);
        if (!shortlist.length)
            return { answers: [], jevCalls: 0 };
        const batchSize = Math.max(1, this.cfg.chunksPerJevRequest * 2);
        const answers = [];
        let jevCalls = 0;
        for (let i = 0; i < shortlist.length; i += batchSize) {
            const batch = shortlist.slice(i, i + batchSize);
            const r = await this.runtime.decide(ASK_SET, ASK_VERSION, { question: redactText(question).slice(0, 2000), chunks: batch.map((b) => ({ id: b.chunk.chunkId, videoTitle: b.title, start: formatTimestamp(b.chunk.startSeconds), text: redactText(b.chunk.text).slice(0, 6000) })) }, askQuestions(batch.length));
            jevCalls += 1;
            batch.forEach((b, k) => answers.push({ chunk: b.chunk, score: score(r.answers, `answers_k${k}`)?.score ?? 0, title: b.title }));
        }
        return { answers: answers.sort((a, b) => b.score - a.score).slice(0, limit), jevCalls };
    }
}
