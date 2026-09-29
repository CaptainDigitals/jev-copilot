import { loadConfig } from '../core/config.js';
import { contextSummary } from '../policy/context-rank.js';
import { renderVerdict } from '../policy/completion.js';
import { profileContext } from '../policy/task-profile.js';
import { currentSessionId, loadSession, Runtime } from '../runtime/index.js';
import { emptyChanges } from '../state/session-store.js';
import { McpToolServer } from './jsonrpc.js';
import { registerYouTubeTools } from './youtube-tools.js';
function str(value, field, max = 20000) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`"${field}" must be a non-empty string`);
    return value.slice(0, max);
}
function optStr(value, max = 20000) {
    return typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined;
}
function strList(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 100) : [];
}
function parseCandidates(value, max) {
    if (!Array.isArray(value) || !value.length)
        throw new Error('"candidates" must be a non-empty array of {path, summary}');
    return value.slice(0, max).map((raw, i) => {
        if (!raw || typeof raw !== 'object')
            throw new Error(`candidates[${i}] must be an object`);
        const c = raw;
        const candidate = { path: str(c.path, `candidates[${i}].path`, 500), summary: str(c.summary, `candidates[${i}].summary`, 1000) };
        const role = optStr(c.role, 40);
        const excerpt = optStr(c.excerpt, 2000);
        if (role)
            candidate.role = role;
        if (excerpt)
            candidate.excerpt = excerpt;
        return candidate;
    });
}
function parseRequirements(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(0, 12).map((raw, i) => {
        const r = (raw && typeof raw === 'object' ? raw : {});
        return {
            id: optStr(r.id, 20) ?? `RQ-${String(i + 1).padStart(2, '0')}`,
            source: r.source === 'inferred' ? 'inferred' : 'explicit',
            text: str(r.text, `requirements[${i}].text`, 300),
            verification: ['diff', 'tests', 'review', 'docs'].find((v) => v === r.verification) ?? 'diff',
            severity: ['high', 'medium', 'low'].find((v) => v === r.severity) ?? 'medium',
            status: 'open',
        };
    });
}
export function createServer(runtime) {
    const server = new McpToolServer({ name: 'jev-copilot', version: '0.2.0' });
    const cfg = runtime.config;
    server.register({
        name: 'jev_status',
        description: 'JEV Copilot configuration, connectivity check and session statistics. Never returns secrets.',
        inputSchema: { type: 'object', properties: { checkApi: { type: 'boolean', description: 'Make one tiny JEV call to verify connectivity (default true).' } } },
        handler: async (args) => runtime.status(args.checkApi !== false),
    });
    server.register({
        name: 'jev_analyze_task',
        description: 'Classify a software task with TypeSafe JEV: task type, complexity, cross-file scope, test necessity, security/data sensitivity, ambiguity, plus the code-owned strategy recommendation and requirement contract. Signals are advisory.',
        inputSchema: { type: 'object', properties: { request: { type: 'string', description: 'The task text.' }, cwd: { type: 'string', description: 'Project directory for a cheap repository summary (optional).' }, repoSummary: { type: 'object', description: 'Optional pre-built repository summary.' } }, required: ['request'] },
        handler: async (args) => {
            const analysis = await runtime.analyzeTask(str(args.request, 'request', cfg.limits.maxPromptChars), optStr(args.cwd, 1000), args.repoSummary);
            return { ...analysis, rendered: profileContext(analysis.profile, analysis.decision) };
        },
    });
    server.register({
        name: 'jev_rank_context',
        description: `Rank a bounded list (max ${cfg.limits.maxCandidateFiles}) of REAL candidate files by relevance to a task. Output paths are always a subset of the input; JEV never invents files.`,
        inputSchema: { type: 'object', properties: { task: { type: 'string' }, candidates: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, summary: { type: 'string' }, role: { type: 'string' }, excerpt: { type: 'string' } }, required: ['path', 'summary'] } } }, required: ['task', 'candidates'] },
        handler: async (args) => {
            const result = await runtime.rankContext(str(args.task, 'task'), parseCandidates(args.candidates, cfg.limits.maxCandidateFiles));
            return { ...result, rendered: contextSummary(result.ranked) };
        },
    });
    server.register({
        name: 'jev_context',
        description: 'Deterministically discover candidate files in a git repository (path/keyword match, uncommitted and recent changes, exclusion policy applied) and rank them with JEV.',
        inputSchema: { type: 'object', properties: { task: { type: 'string' }, cwd: { type: 'string', description: 'Repository root (defaults to the server working directory).' } }, required: ['task'] },
        handler: async (args) => {
            const result = await runtime.discoverAndRank(str(args.task, 'task'), optStr(args.cwd, 1000) ?? process.cwd());
            return { keywords: result.discovery.keywords, totalTracked: result.discovery.totalTracked, gitAvailable: result.discovery.gitAvailable, ranked: result.ranked, rendered: result.ranked.length ? contextSummary(result.ranked) : 'No candidates discovered (not a git repository or no path matches).' };
        },
    });
    server.register({
        name: 'jev_review_completion',
        description: 'Review an implementation against its requirement contract and evidence. With no arguments, uses the state tracked by the JEV Copilot hooks for the current session.',
        inputSchema: { type: 'object', properties: { request: { type: 'string' }, requirements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, source: { type: 'string', enum: ['explicit', 'inferred'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, verification: { type: 'string', enum: ['diff', 'tests', 'review', 'docs'] } }, required: ['text'] } }, changedFiles: { type: 'array', items: { type: 'string' } }, createdFiles: { type: 'array', items: { type: 'string' } }, deletedFiles: { type: 'array', items: { type: 'string' } }, tests: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string', enum: ['pass', 'fail', 'unknown'] } }, required: ['command'] } }, claim: { type: 'string', description: 'The completion claim / summary being verified.' }, testEvidenceExpected: { type: 'boolean' } } },
        handler: async (args) => {
            const session = loadSession(runtime.sessionId);
            const claim = optStr(args.claim, 8000) ?? '';
            const fromSession = runtime.reviewInputFromSession(session, claim);
            const explicit = optStr(args.request, cfg.limits.maxPromptChars);
            const input = explicit
                ? {
                    request: explicit,
                    requirements: parseRequirements(args.requirements),
                    changes: { ...emptyChanges(), created: strList(args.createdFiles), modified: strList(args.changedFiles), deleted: strList(args.deletedFiles) },
                    tests: Array.isArray(args.tests) ? args.tests.map((t) => { const r = (t && typeof t === 'object' ? t : {}); return { command: str(r.command, 'tests[].command', 300), outcome: ['pass', 'fail', 'unknown'].find((o) => o === r.outcome) ?? 'unknown', at: new Date().toISOString() }; }) : [],
                    claim,
                    testEvidenceExpected: args.testEvidenceExpected === true,
                }
                : fromSession;
            if (!input)
                throw new Error('No review state: pass request/requirements/changedFiles explicitly, or make changes in a hooked session first.');
            if (!input.requirements.length)
                input.requirements = parseRequirements([{ text: input.request.slice(0, 300) }]);
            const { verdict, meta } = await runtime.reviewCompletion(input);
            return { verdict, meta, rendered: renderVerdict(verdict) };
        },
    });
    server.register({
        name: 'jev_assess_tool_action',
        description: 'Deterministic risk classification of a proposed tool call (Bash/PowerShell/Write/Edit), optionally supplemented by JEV for high-impact actions. Hard rules cannot be overridden by JEV.',
        inputSchema: { type: 'object', properties: { toolName: { type: 'string' }, toolInput: { type: 'object' }, cwd: { type: 'string' }, task: { type: 'string' } }, required: ['toolName', 'toolInput'] },
        handler: async (args) => runtime.assessToolAction(str(args.toolName, 'toolName', 100), (args.toolInput && typeof args.toolInput === 'object' ? args.toolInput : {}), optStr(args.cwd, 1000), optStr(args.task, 4000)),
    });
    server.register({
        name: 'jev_session_stats',
        description: 'Local JEV Copilot telemetry for the current session: calls, cache hits, latency, tokens, estimated cost, repairs, escalations.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => runtime.stats(),
    });
    registerYouTubeTools(server, runtime);
    return server;
}
const invokedDirectly = process.argv[1] && /server\.(?:js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
    const config = loadConfig(process.env, process.cwd());
    createServer(new Runtime(config, currentSessionId())).serve();
}
