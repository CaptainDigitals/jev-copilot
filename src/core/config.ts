import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Mode = 'off' | 'assist' | 'enhance' | 'strict';

export interface CompletionThresholds {
  implementationComplete: number;
  unresolvedRequirement: number;
  likelyRegression: number;
  securityConcern: number;
  testsSufficient: number;
}

export interface YouTubeResearchConfig {
  ytDlpPath: string;
  ytDlpTimeoutMs: number;
  maxVideos: number;
  maxTranscriptChars: number;
  languages: string[];
  enableAsrFallback: boolean;
  chunk: { targetTokens: number; maxTokens: number; minTokens: number };
  chunksPerJevRequest: number;
  workers: { metadata: number; transcripts: number; jev: number; deep: number };
  routing: { deep: number; focused: number; archive: number; weights: { relevance: number; technicalDepth: number; actionability: number; novelty: number; evidenceDensity: number; promotionPenalty: number } };
  /** `claude-session` (Claude synthesizes from the bundle) or an OpenRouter chat model id. */
  deepModel: string;
  deepTimeoutMs: number;
  deepMaxInputChars: number;
  deepMaxOutputTokens: number;
  maxDeepChunksPerVideo: number;
  maxDeepVideos: number;
  budgetUsd: number;
  dedupe: boolean;
  frames: { mode: 'off' | 'light' | 'standard' | 'deep' };
}

export interface Config {
  mode: Mode;
  jevModel: string;
  endpoint: string;
  apiKey: string;
  completionReviewEnabled: boolean;
  toolGovernanceEnabled: boolean;
  sessionBudgetUsd: number;
  network: { timeoutMs: number; maxRetries: number; retryBaseDelayMs: number };
  limits: {
    minPromptChars: number;
    maxPromptChars: number;
    maxCandidateFiles: number;
    contextBatchSize: number;
    maxRepairLoops: number;
    maxStateChars: number;
    maxExcerptChars: number;
    maxChangedFilesInReview: number;
  };
  thresholds: {
    highConfidence: number;
    mediumConfidence: number;
    planComplexity: number;
    crossFileScope: number;
    testsRequired: number;
    securitySensitive: number;
    ambiguity: number;
    context: { full: number; excerpt: number };
    completion: { enhance: CompletionThresholds; strict: CompletionThresholds };
    tool: { askOnDestructive: boolean; askWhenTaskRelevantBelow: number; askWhenHumanConfirmationAbove: number };
  };
  pricing: { inputUsdPerMillion: number; outputUsdPerMillion: number };
  cache: { enabled: boolean; ttlSeconds: number };
  telemetry: { enabled: boolean; includeRawPrompts: boolean; includeSourceText: boolean };
  excludedPaths: string[];
  youtubeResearch: YouTubeResearchConfig;
  /** Where the config values came from, for /jev-copilot:status. Never includes the key. */
  sources: string[];
}

export type Env = Record<string, string | undefined>;

const MODES: readonly Mode[] = ['off', 'assist', 'enhance', 'strict'];
const PROJECT_OVERRIDE_FILE = '.jev-copilot.json';

export function pluginRoot(): string {
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (fromEnv && existsSync(join(fromEnv, 'config', 'defaults.json'))) return fromEnv;
  // dist/src/core/config.js -> plugin root is three levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..');
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge that returns a new object; arrays and scalars in `override` replace. */
export function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseMode(value: string | undefined): Mode | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return (MODES as readonly string[]).includes(v) ? (v as Mode) : undefined;
}

/** Substitution placeholders that Claude Code leaves in place when the option is unset. */
function cleanEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v === '' || /^\$\{user_config\.[a-z0-9_]+\}$/i.test(v)) return undefined;
  return v;
}

function envOverrides(env: Env): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const mode = parseMode(cleanEnv(env.JEV_COPILOT_MODE) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_MODE));
  if (mode) out.mode = mode;
  const model = cleanEnv(env.JEV_MODEL) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_JEV_MODEL);
  if (model && /^~?[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(model)) out.jevModel = model;
  const review = parseBool(cleanEnv(env.JEV_COPILOT_COMPLETION_REVIEW) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_COMPLETION_REVIEW_ENABLED));
  if (review !== undefined) out.completionReviewEnabled = review;
  const governance = parseBool(cleanEnv(env.JEV_COPILOT_TOOL_GOVERNANCE) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_TOOL_GOVERNANCE_ENABLED));
  if (governance !== undefined) out.toolGovernanceEnabled = governance;
  const budget = parseNumber(cleanEnv(env.JEV_COPILOT_SESSION_BUDGET_USD) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_SESSION_BUDGET_USD));
  if (budget !== undefined && budget >= 0) out.sessionBudgetUsd = budget;
  const deepModel = cleanEnv(env.JEV_COPILOT_DEEP_MODEL) ?? cleanEnv(env.CLAUDE_PLUGIN_OPTION_DEEP_MODEL);
  if (deepModel && (deepModel === 'claude-session' || /^[a-z0-9._~-]+\/[a-z0-9._:-]+$/i.test(deepModel))) out.youtubeResearch = { deepModel };
  const ytdlp = cleanEnv(env.JEV_COPILOT_YTDLP_PATH);
  if (ytdlp && !/[\s;&|<>]/.test(ytdlp)) out.youtubeResearch = { ...(isRecord(out.youtubeResearch) ? out.youtubeResearch : {}), ytDlpPath: ytdlp };
  return out;
}

function resolveApiKey(env: Env): string {
  const candidates = [env.OPENROUTER_API_KEY, env.CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY];
  for (const candidate of candidates) {
    const v = cleanEnv(candidate);
    if (v) return v;
  }
  return '';
}

function validateEndpoint(endpoint: unknown, fallback: string): string {
  if (typeof endpoint !== 'string') return fallback;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

/**
 * Loads configuration in precedence order:
 * defaults.json < project .jev-copilot.json (non-secret only) < environment / plugin user config.
 * The project override can never set the API key or endpoint host.
 */
export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): Config {
  const root = pluginRoot();
  const defaultsPath = join(root, 'config', 'defaults.json');
  const defaults = readJson(defaultsPath);
  if (!defaults) throw new Error(`JEV Copilot defaults missing at ${defaultsPath}`);
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
  const config = {
    ...(merged as unknown as Omit<Config, 'apiKey' | 'sources' | 'mode' | 'endpoint'>),
    mode: modeValue,
    endpoint: validateEndpoint(merged.endpoint, 'https://openrouter.ai/api/alpha/decisions'),
    apiKey: resolveApiKey(env),
    sources,
  } as Config;
  return config;
}

export function completionThresholds(config: Config): CompletionThresholds {
  return config.mode === 'strict' ? config.thresholds.completion.strict : config.thresholds.completion.enhance;
}
