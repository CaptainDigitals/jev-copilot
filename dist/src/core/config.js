import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStoredKey } from './credentials.js';
const MODES = ['off', 'assist', 'enhance', 'strict'];
const PROJECT_OVERRIDE_FILE = '.jev-copilot.json';
export function pluginRoot() {
    const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
    if (fromEnv && existsSync(join(fromEnv, 'config', 'defaults.json')))
        return fromEnv;
    // dist/src/core/config.js -> plugin root is three levels up.
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, '..', '..', '..');
}
function readJson(path) {
    try {
        if (!existsSync(path))
            return undefined;
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Deep merge that returns a new object; arrays and scalars in `override` replace. */
export function deepMerge(base, override) {
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const current = out[key];
        out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
    }
    return out;
}
function parseBool(value) {
    if (value === undefined || value === '')
        return undefined;
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v))
        return true;
    if (['0', 'false', 'no', 'off'].includes(v))
        return false;
    return undefined;
}
function parseNumber(value) {
    if (value === undefined || value.trim() === '')
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function parseMode(value) {
    if (!value)
        return undefined;
    const v = value.trim().toLowerCase();
    return MODES.includes(v) ? v : undefined;
}
/** Substitution placeholders that Claude Code leaves in place when the option is unset. */
function cleanEnv(value) {
    if (value === undefined)
        return undefined;
    const v = value.trim();
    if (v === '' || /^\$\{user_config\.[a-z0-9_]+\}$/i.test(v))
        return undefined;
    return v;
}
function envOverrides(env) {
    const out = {};
    const mode = parseMode(cleanEnv(env.JEV_COPILOT_MODE) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_MODE));
    if (mode)
        out.mode = mode;
    const model = cleanEnv(env.JEV_MODEL) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_JEV_MODEL);
    if (model && /^~?[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(model))
        out.jevModel = model;
    const review = parseBool(cleanEnv(env.JEV_COPILOT_COMPLETION_REVIEW) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_COMPLETION_REVIEW_ENABLED));
    if (review !== undefined)
        out.completionReviewEnabled = review;
    const governance = parseBool(cleanEnv(env.JEV_COPILOT_TOOL_GOVERNANCE) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_TOOL_GOVERNANCE_ENABLED));
    if (governance !== undefined)
        out.toolGovernanceEnabled = governance;
    const budget = parseNumber(cleanEnv(env.JEV_COPILOT_SESSION_BUDGET_USD) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_SESSION_BUDGET_USD));
    if (budget !== undefined && budget >= 0)
        out.sessionBudgetUsd = budget;
    const deepModel = cleanEnv(env.JEV_COPILOT_DEEP_MODEL) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_DEEP_MODEL);
    if (deepModel && (deepModel === 'claude-session' || /^[a-z0-9._~-]+\/[a-z0-9._:-]+$/i.test(deepModel)))
        out.youtubeResearch = { deepModel };
    const ytdlp = cleanEnv(env.JEV_COPILOT_YTDLP_PATH);
    if (ytdlp && !/[\s;&|<>]/.test(ytdlp))
        out.youtubeResearch = { ...(isRecord(out.youtubeResearch) ? out.youtubeResearch : {}), ytDlpPath: ytdlp };
    return out;
}
/**
 * Key precedence: the plugin's sensitive user option (Claude Code credential store), then the
 * environment, then the plugin-owned credentials file written by `cli.js configure`.
 */
function resolveApiKey(env) {
    const fromPlugin = cleanEnv(env.CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY);
    if (fromPlugin)
        return { apiKey: fromPlugin, keySource: 'plugin-config' };
    const fromEnv = cleanEnv(env.OPENROUTER_API_KEY);
    if (fromEnv)
        return { apiKey: fromEnv, keySource: 'environment' };
    const stored = readStoredKey(env);
    if (stored)
        return { apiKey: stored, keySource: 'credentials-file' };
    return { apiKey: '', keySource: 'none' };
}
function validateEndpoint(endpoint, fallback) {
    if (typeof endpoint !== 'string')
        return fallback;
    try {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:')
            return fallback;
        return url.toString();
    }
    catch {
        return fallback;
    }
}
/**
 * Loads configuration in precedence order:
 * defaults.json < project .jev-copilot.json (non-secret only) < environment / plugin user config.
 * The project override can never set the API key or endpoint host.
 */
export function loadConfig(env = process.env, cwd = process.cwd()) {
    const root = pluginRoot();
    const defaultsPath = join(root, 'config', 'defaults.json');
    const defaults = readJson(defaultsPath);
    if (!defaults)
        throw new Error(`JEV Copilot defaults missing at ${defaultsPath}`);
    const sources = ['defaults'];
    let merged = defaults;
    const projectPath = join(cwd, PROJECT_OVERRIDE_FILE);
    const project = readJson(projectPath);
    if (project) {
        const { apiKey: _k, endpoint: _e, ...safe } = project;
        merged = deepMerge(merged, safe);
        sources.push(PROJECT_OVERRIDE_FILE);
    }
    const fromEnv = envOverrides(env);
    if (Object.keys(fromEnv).length) {
        merged = deepMerge(merged, fromEnv);
        sources.push('environment');
    }
    const modeValue = parseMode(typeof merged.mode === 'string' ? merged.mode : undefined) ?? 'enhance';
    const key = resolveApiKey(env);
    if (key.keySource === 'credentials-file')
        sources.push('credentials-file');
    const config = {
        ...merged,
        mode: modeValue,
        endpoint: validateEndpoint(merged.endpoint, 'https://openrouter.ai/api/alpha/decisions'),
        apiKey: key.apiKey,
        keySource: key.keySource,
        sources,
    };
    return config;
}
export function completionThresholds(config) {
    return config.mode === 'strict' ? config.thresholds.completion.strict : config.thresholds.completion.enhance;
}
