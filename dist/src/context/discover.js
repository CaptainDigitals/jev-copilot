import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PathPolicy, classifyFileRole, normalizePath } from '../security/exclusions.js';
import { looksBinary, redactText } from '../security/redact.js';
const STOPWORDS = new Set(['this', 'that', 'with', 'from', 'into', 'when', 'then', 'than', 'have', 'will', 'should', 'would', 'could', 'make', 'also', 'need', 'needs', 'want', 'like', 'just', 'only', 'file', 'files', 'code', 'please', 'using', 'used', 'user', 'users', 'where', 'which', 'what', 'about', 'after', 'before', 'every', 'their', 'there', 'these', 'those', 'them', 'they', 'your', 'ours', 'does', 'done', 'each', 'more', 'most', 'some', 'such', 'very', 'been', 'being', 'were', 'while', 'still', 'implement', 'update', 'change', 'changes', 'function', 'method', 'class', 'the', 'and', 'for', 'not', 'are', 'but', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out', 'has', 'how', 'its', 'new', 'now', 'add', 'fix']);
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TRACKED_FILES = 20000;
const SYMBOL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var|def|struct|fn|impl|trait|module|public\s+(?:static\s+)?(?:class|interface|void|[A-Za-z<>\[\]]+))\s+([A-Za-z_][A-Za-z0-9_]*)/;
function git(cwd, args) {
    try {
        const out = execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 });
        return out.split('\n').map((l) => l.trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
export function extractKeywords(task) {
    const tokens = new Set();
    for (const raw of task.split(/[^A-Za-z0-9_./-]+/)) {
        if (!raw)
            continue;
        // Split identifiers: camelCase, snake_case, kebab-case, dotted paths.
        const pieces = raw.split(/(?<=[a-z0-9])(?=[A-Z])|[_./-]/).map((p) => p.toLowerCase()).filter((p) => p.length >= 3 && !STOPWORDS.has(p));
        for (const p of pieces)
            tokens.add(p);
        const whole = raw.toLowerCase();
        if (whole.length >= 4 && !STOPWORDS.has(whole))
            tokens.add(whole);
    }
    return [...tokens].slice(0, 40);
}
function scorePaths(files, keywords, changed, recent) {
    const scored = [];
    for (const file of files) {
        const lower = file.toLowerCase();
        const reasons = [];
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) {
                score += kw.length >= 6 ? 3 : 2;
                reasons.push(`path matches "${kw}"`);
            }
        }
        if (changed.has(file)) {
            score += 4;
            reasons.push('uncommitted change');
        }
        if (recent.has(file)) {
            score += 1.5;
            reasons.push('recently committed');
        }
        if (score > 0)
            scored.push({ path: file, score, reasons });
    }
    return scored.sort((a, b) => b.score - a.score);
}
function summarize(cwd, path, maxExcerpt) {
    try {
        const full = join(cwd, path);
        const size = statSync(full).size;
        if (size > MAX_FILE_BYTES)
            return { summary: `large file (${Math.round(size / 1024)} KB); excerpt omitted`, excerpt: '' };
        const text = readFileSync(full, 'utf8');
        if (looksBinary(text))
            return undefined;
        const lines = text.split('\n');
        const symbols = [];
        for (const line of lines) {
            const m = SYMBOL.exec(line.trim());
            if (m?.[1])
                symbols.push(m[1]);
            if (symbols.length >= 12)
                break;
        }
        const head = lines.filter((l) => l.trim()).slice(0, 12).join('\n');
        const excerpt = redactText(head).slice(0, maxExcerpt);
        const summary = `${lines.length} lines; roles: ${classifyFileRole(path).join(',')}${symbols.length ? `; symbols: ${symbols.join(', ')}` : ''}`;
        return { summary, excerpt };
    }
    catch {
        return undefined;
    }
}
/**
 * Deterministic candidate discovery (PRD FR-007): git-tracked files scored by path/keyword
 * match, uncommitted changes and recent history, filtered by the exclusion policy and
 * summarized locally. JEV never touches the filesystem.
 */
export function discoverCandidates(task, cwd, config) {
    const policy = new PathPolicy(config.excludedPaths);
    const keywords = extractKeywords(task);
    const gitFiles = existsSync(join(cwd, '.git')) || git(cwd, ['rev-parse', '--is-inside-work-tree']).length ? git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard']) : [];
    const gitAvailable = gitFiles.length > 0;
    const tracked = policy.filter(gitFiles.map(normalizePath)).slice(0, MAX_TRACKED_FILES);
    const changed = new Set(policy.filter(git(cwd, ['diff', '--name-only', 'HEAD']).map(normalizePath)));
    const recent = new Set(policy.filter(git(cwd, ['log', '--name-only', '-n', '30', '--pretty=format:']).map(normalizePath)));
    const scored = scorePaths(tracked, keywords, changed, recent);
    const candidates = [];
    for (const item of scored) {
        if (candidates.length >= config.limits.maxCandidateFiles)
            break;
        const info = summarize(cwd, item.path, config.limits.maxExcerptChars);
        if (!info)
            continue;
        const candidate = { path: item.path, summary: `${info.summary}; signals: ${item.reasons.slice(0, 3).join('; ')}`, role: classifyFileRole(item.path)[0] ?? 'source' };
        if (info.excerpt)
            candidate.excerpt = info.excerpt;
        candidates.push(candidate);
    }
    return { candidates, totalTracked: tracked.length, keywords, gitAvailable };
}
/** Cheap repository summary attached to task analysis: top-level paths and language mix. */
export function repoSummary(cwd) {
    const files = git(cwd, ['ls-files']).map(normalizePath);
    const top = new Set();
    const ext = new Map();
    for (const f of files) {
        const first = f.split('/')[0];
        if (first)
            top.add(first);
        const e = f.includes('.') ? f.slice(f.lastIndexOf('.') + 1).toLowerCase() : '';
        if (e && e.length <= 5)
            ext.set(e, (ext.get(e) ?? 0) + 1);
    }
    const languages = [...ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e]) => e);
    const changedFiles = git(cwd, ['diff', '--name-only', 'HEAD']).map(normalizePath).slice(0, 20);
    return { topLevelPaths: [...top].sort().slice(0, 40), languages, changedFiles };
}
