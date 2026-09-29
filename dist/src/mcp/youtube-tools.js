import { citation } from '../youtube/deep.js';
import { YouTubeResearchEngine } from '../youtube/engine.js';
import { renderCostEstimate } from '../youtube/report.js';
const MODES = ['fast', 'standard', 'deep', 'audit'];
const TASKS = ['research', 'analyze', 'compare', 'parts', 'steps'];
/** Largest artifact slice returned by one tool call; larger artifacts are paged with offset. */
const MAX_SLICE = 120_000;
function strings(value, max) {
    if (typeof value === 'string')
        return value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, max);
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()).slice(0, max) : [];
}
function optNumber(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
}
function optString(value, max) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}
function pick(value, allowed) {
    return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}
export function parseJobOptions(args) {
    const out = {};
    const mode = pick(args.mode, MODES);
    const task = pick(args.task, TASKS);
    const maxVideos = optNumber(args.maxVideos, 1, 500);
    const top = optNumber(args.top, 1, 200);
    const budgetUsd = optNumber(args.budgetUsd, 0, 1000);
    const deepModel = optString(args.deepModel, 120);
    const collection = optString(args.collection, 64);
    if (mode)
        out.mode = mode;
    if (task)
        out.task = task;
    if (maxVideos)
        out.maxVideos = Math.floor(maxVideos);
    if (top)
        out.top = Math.floor(top);
    if (budgetUsd !== undefined)
        out.budgetUsd = budgetUsd;
    if (deepModel)
        out.deepModel = deepModel;
    if (collection)
        out.collection = collection;
    if (typeof args.analyzeAll === 'boolean')
        out.analyzeAll = args.analyzeAll;
    if (typeof args.dedupe === 'boolean')
        out.dedupe = args.dedupe;
    return out;
}
function slice(text, offset) {
    const total = text?.length ?? 0;
    const start = Math.min(Math.max(0, offset), total);
    const end = Math.min(total, start + MAX_SLICE);
    return { text: (text ?? '').slice(start, end), offset: start, totalChars: total, nextOffset: end < total ? end : null };
}
export function renderOutcome(outcome) {
    const { job, estimate } = outcome;
    if (outcome.overBudget) {
        return [`Job ${job.jobId} paused before screening: the estimate exceeds the budget of $${job.options.budgetUsd}.`, renderCostEstimate(estimate), `Re-run with confirmOverBudget=true (or a higher budgetUsd) to continue, e.g. jev_youtube_job { jobId: "${job.jobId}", resume: true, confirmOverBudget: true }.`].join('\n');
    }
    const routed = job.videoOrder.map((id) => job.videos[id]).filter((v) => v?.screening && (v.screening.route === 'deep' || v.screening.route === 'focused')).length;
    return [
        `Job ${job.jobId} ${job.state}: ${job.metrics.videosDiscovered} discovered, ${job.videoOrder.filter((id) => job.videos[id]?.status === 'READY').length} with transcripts, ${job.metrics.videosProcessed} screened, ${routed} routed for deep analysis, ${job.metrics.duplicateClusters} duplicate clusters, ${job.metrics.processingErrors} errors.`,
        `JEV calls: ${job.metrics.jevCalls} · deep model calls: ${job.metrics.deepModelCalls} · est. cost $${job.metrics.estimatedCostUsd.toFixed(4)} (JEV ≈ $${estimate.jevCostUsd.toFixed(4)})`,
        `Report: ${outcome.reportPath ?? job.reportPath ?? 'n/a'}`,
        `Bundle: ${outcome.bundlePath ?? job.bundlePath ?? 'n/a'}`,
        job.options.deepModel === 'claude-session' ? 'Deep model: claude-session. Synthesize from the returned evidence bundle following the jev-research skill, then store the synthesis with jev_youtube_export.' : `Deep model: ${job.options.deepModel} (synthesis included in the report).`,
    ].join('\n');
}
export function registerYouTubeTools(server, runtime) {
    const engine = new YouTubeResearchEngine(runtime);
    const optionSchema = {
        mode: { type: 'string', enum: [...MODES], description: 'fast = screening only; standard (default); deep = more videos routed deep; audit = everything.' },
        task: { type: 'string', enum: [...TASKS], description: 'research (default), analyze (single video), compare, parts, steps.' },
        maxVideos: { type: 'number', description: 'Cap on discovered videos (default from config, max 500).' },
        top: { type: 'number', description: 'How many best-routed videos receive deep treatment (default 20).' },
        analyzeAll: { type: 'boolean', description: 'Deep-treat every screened video regardless of routing.' },
        dedupe: { type: 'boolean', description: 'Suppress near-duplicate videos (default true).' },
        budgetUsd: { type: 'number', description: 'Pause before screening when the estimate exceeds this (default 5).' },
        deepModel: { type: 'string', description: '"claude-session" (default: Claude synthesizes from the bundle) or an OpenRouter chat model id for headless deep analysis.' },
        collection: { type: 'string', description: 'Named collection to read from and add results to.' },
    };
    server.register({
        name: 'jev_youtube_research',
        description: 'Run the YouTube mass research engine: discover videos (URLs, ids, playlists, channels, topic text, or a .txt of URLs), fetch transcripts with yt-dlp (never media), chunk them, screen every video and chunk with JEV, route by research value, deduplicate, and produce a cited evidence bundle plus report. Costs cents in JEV calls; large corpora take minutes. Returns the bundle for Claude to synthesize when deepModel is claude-session.',
        inputSchema: {
            type: 'object',
            properties: { inputs: { type: 'array', items: { type: 'string' }, description: 'YouTube URLs / ids / playlist / channel URLs, topic text, or a path to a .txt of URLs.' }, question: { type: 'string', description: 'The research question the screening is judged against.' }, confirmOverBudget: { type: 'boolean' }, ...optionSchema },
            required: ['inputs'],
        },
        handler: async (args) => {
            const inputs = strings(args.inputs, 200);
            if (!inputs.length)
                throw new Error('"inputs" must contain at least one URL, id, topic or file path');
            const start = { inputs, ...parseJobOptions(args), ...(optString(args.question, 2000) ? { question: optString(args.question, 2000) } : {}), confirmOverBudget: args.confirmOverBudget === true };
            const outcome = await engine.run(start);
            const bundle = outcome.overBudget ? undefined : engine.store.getArtifact(outcome.job.jobId, 'bundle.md');
            return { jobId: outcome.job.jobId, state: outcome.job.state, overBudget: outcome.overBudget, estimate: outcome.estimate, metrics: outcome.job.metrics, reportPath: outcome.reportPath ?? null, bundlePath: outcome.bundlePath ?? null, rendered: renderOutcome(outcome), bundle: bundle ? slice(bundle, 0) : null };
        },
    });
    server.register({
        name: 'jev_youtube_job',
        description: 'Inspect, list or resume research jobs. Without jobId lists recent jobs. With resume=true continues an interrupted or over-budget job from its persisted state.',
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, resume: { type: 'boolean' }, confirmOverBudget: { type: 'boolean' }, limit: { type: 'number' } } },
        handler: async (args) => {
            const jobId = optString(args.jobId, 64);
            if (!jobId) {
                const jobs = engine.store.listJobs(Math.floor(optNumber(args.limit, 1, 100) ?? 20));
                return { jobs: jobs.map((j) => ({ jobId: j.jobId, state: j.state, question: j.question, videos: j.videoOrder.length, updatedAt: j.updatedAt, task: j.options.task })), rendered: jobs.length ? jobs.map((j) => `${j.jobId} · ${j.state} · ${j.videoOrder.length} videos · ${j.question.slice(0, 80)}`).join('\n') : 'No research jobs yet.' };
            }
            if (args.resume === true) {
                const outcome = await engine.resume(jobId, args.confirmOverBudget === true);
                return { jobId, state: outcome.job.state, overBudget: outcome.overBudget, estimate: outcome.estimate, metrics: outcome.job.metrics, rendered: renderOutcome(outcome) };
            }
            const job = engine.store.loadJob(jobId);
            if (!job)
                throw new Error(`unknown job ${jobId}`);
            const estimate = engine.estimate(job);
            return { job: { ...job, videos: undefined }, videos: job.videoOrder.map((id) => job.videos[id]), estimate, rendered: `${job.jobId} · ${job.state} · ${job.question}\n${renderCostEstimate(estimate)}${job.error ? `\nError: ${job.error}` : ''}` };
        },
    });
    server.register({
        name: 'jev_youtube_bundle',
        description: 'Read a research job artifact (bundle.md = cited evidence for synthesis, report.md, report.json, synthesis.md) in pages of up to 120k characters.',
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, artifact: { type: 'string', enum: ['bundle.md', 'report.md', 'report.json', 'synthesis.md'] }, offset: { type: 'number' } }, required: ['jobId'] },
        handler: async (args) => {
            const jobId = optString(args.jobId, 64) ?? '';
            const artifact = pick(args.artifact, ['bundle.md', 'report.md', 'report.json', 'synthesis.md']) ?? 'bundle.md';
            const text = engine.store.getArtifact(jobId, artifact);
            if (text === undefined)
                throw new Error(`no ${artifact} for job ${jobId}`);
            return { jobId, artifact, ...slice(text, Math.floor(optNumber(args.offset, 0, Number.MAX_SAFE_INTEGER) ?? 0)) };
        },
    });
    server.register({
        name: 'jev_youtube_evidence',
        description: 'Cited transcript evidence (routed chunks with [videoId@m:ss](url) citations) for one video of a job. Use when the bundle omitted a video or a claim needs more context.',
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, videoId: { type: 'string' } }, required: ['jobId', 'videoId'] },
        handler: async (args) => {
            const text = engine.evidence(optString(args.jobId, 64) ?? '', optString(args.videoId, 11) ?? '');
            if (!text)
                throw new Error('no evidence for that job/video (not ingested, or unknown ids)');
            return { evidence: text };
        },
    });
    server.register({
        name: 'jev_youtube_export',
        description: 'Store the synthesis Claude wrote for a job (Markdown) and re-render report.md / report.json with it merged. Without synthesis, only re-renders.',
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, synthesis: { type: 'string', description: 'The full synthesis Markdown (Executive Summary … Recommended Follow-up Research) with citations.' } }, required: ['jobId'] },
        handler: async (args) => {
            const jobId = optString(args.jobId, 64) ?? '';
            const synthesis = typeof args.synthesis === 'string' && args.synthesis.trim() ? args.synthesis.slice(0, 400_000) : undefined;
            const paths = engine.refreshReport(jobId, synthesis);
            return { ...paths, rendered: `Report written to ${paths.reportPath}${synthesis ? ' with your synthesis merged' : ''}; JSON at ${paths.jsonPath}.` };
        },
    });
    server.register({
        name: 'jev_youtube_ask',
        description: 'Follow-up question over a completed job or a collection: keyword prefilter, then JEV ranks which transcript chunks answer it. Returns cited chunks; Claude composes the answer from them.',
        inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'Job id or collection name.' }, question: { type: 'string' }, limit: { type: 'number' } }, required: ['target', 'question'] },
        handler: async (args) => {
            const target = optString(args.target, 64);
            const question = optString(args.question, 2000);
            if (!target || !question)
                throw new Error('"target" and "question" are required');
            const result = await engine.ask(target, question, Math.floor(optNumber(args.limit, 1, 20) ?? 8));
            const rendered = result.answers.length ? result.answers.map((a) => `- (${a.score.toFixed(1)}/3) ${a.title} ${citation(a.chunk)}\n  ${a.chunk.text.slice(0, 600)}`).join('\n') : 'No transcript chunks matched the question keywords.';
            return { ...result, rendered };
        },
    });
}
