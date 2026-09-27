import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { completionThresholds, type Config } from '../core/config.js';
import { hashValue } from '../core/hash.js';
import { debugLog, describeError } from '../core/logger.js';
import { sessionsDir } from '../core/paths.js';
import { DecisionCache } from '../jev/cache.js';
import { JevClient } from '../jev/client.js';
import { COMPLETION_QUESTION_SET, COMPLETION_QUESTION_SET_VERSION, completionQuestions, requirementCoverageQuestions } from '../jev/questions/completion.js';
import { CONTEXT_QUESTION_SET, CONTEXT_QUESTION_SET_VERSION, contextQuestions, type ContextCandidate } from '../jev/questions/context.js';
import { TASK_QUESTION_SET, TASK_QUESTION_SET_VERSION, taskAnalysisQuestions } from '../jev/questions/task.js';
import { TOOL_QUESTION_SET, TOOL_QUESTION_SET_VERSION, toolActionQuestions } from '../jev/questions/tool.js';
import { choice, noul } from '../jev/schema.js';
import { JevError, type DecisionResult, type QuestionBundle } from '../jev/types.js';
import { evaluateCompletion, type CompletionVerdict } from '../policy/completion.js';
import { rankCandidates, type RankedCandidate } from '../policy/context-rank.js';
import { decideStrategy, mapTaskProfile, type StrategyDecision, type TaskProfile } from '../policy/task-profile.js';
import { classifyToolAction, type DeterministicAssessment } from '../policy/tool-risk.js';
import { redactText, redactValue } from '../security/redact.js';
import { buildRequirementContract, type Requirement } from '../state/requirements.js';
import { loadSession, saveSession, totalChangedFiles, type SessionState } from '../state/session-store.js';
import { Telemetry, type SessionStats } from '../state/telemetry.js';
import { discoverCandidates, repoSummary, type DiscoveryResult } from '../context/discover.js';

export const POLICY_VERSION = '1.0.0';

export interface RuntimeDeps {
  fetchImpl?: typeof fetch;
  telemetry?: Telemetry;
  cache?: DecisionCache;
  now?: () => number;
}

export interface TaskAnalysis {
  profile: TaskProfile;
  decision: StrategyDecision;
  requirements: Requirement[];
  meta: DecisionResult['meta'];
}

export interface ToolDecision {
  deterministic: DeterministicAssessment;
  jev?: { impact: string; impactConfidence: number; taskRelevant: number; requiresHumanConfirmation: number };
  action: 'allow' | 'ask' | 'deny' | 'none';
  reason: string;
}

export interface StatusReport {
  mode: string;
  model: string;
  endpointHost: string;
  keyConfigured: boolean;
  api: 'connected' | 'error' | 'not-configured' | 'not-checked';
  apiDetail?: string;
  completionReview: boolean;
  toolGovernance: boolean;
  sessionBudgetUsd: number;
  configSources: string[];
  session?: { id: string; taskType?: string; changedFiles: number; requirements: number; repairs: number };
  stats: SessionStats;
}

export interface CompletionReviewInput {
  request: string;
  requirements: Requirement[];
  changes: SessionState['changes'];
  tests: SessionState['tests'];
  claim: string;
  testEvidenceExpected: boolean;
}

/** Most recently updated hook session, so MCP/CLI calls share state with hooks. */
export function currentSessionId(): string {
  try {
    const dir = sessionsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let best: { id: string; mtime: number } | undefined;
    for (const f of files) {
      const mtime = statSync(join(dir, f)).mtimeMs;
      if (!best || mtime > best.mtime) best = { id: f.slice(0, -5), mtime };
    }
    return best?.id ?? 'local';
  } catch {
    return 'local';
  }
}

/**
 * Shared runtime used by hooks, the MCP server and the CLI. One place for
 * cache, budget, telemetry and the JEV-answers/code-decides boundary.
 */
export class Runtime {
  readonly client: JevClient;
  readonly telemetry: Telemetry;
  readonly cache: DecisionCache;
  private readonly now: () => number;

  constructor(readonly config: Config, readonly sessionId: string, deps: RuntimeDeps = {}) {
    const clientOptions = { apiKey: config.apiKey, endpoint: config.endpoint, ...config.network, maxStateChars: config.limits.maxStateChars, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) };
    this.client = new JevClient(clientOptions);
    this.telemetry = deps.telemetry ?? new Telemetry(config.telemetry.enabled);
    this.cache = deps.cache ?? new DecisionCache(config.cache.enabled, config.cache.ttlSeconds);
    this.now = deps.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.config.mode !== 'off' && this.client.configured;
  }

  stats(): SessionStats {
    return this.telemetry.stats(this.sessionId, this.config.mode, this.config.jevModel);
  }

  budgetExhausted(): boolean {
    const budget = this.config.sessionBudgetUsd;
    return budget > 0 && this.stats().estimatedCostUsd >= budget;
  }

  /** Core decision path: redact -> size guard -> cache -> OpenRouter -> validate -> telemetry. */
  async decide(questionSet: string, version: string, state: unknown, questions: QuestionBundle, options: { optional?: boolean } = {}): Promise<DecisionResult> {
    if (this.config.mode === 'off') throw new JevError('JEV Copilot mode is off', 'config');
    if (options.optional !== false && this.budgetExhausted()) {
      this.telemetry.record({ sessionId: this.sessionId, kind: 'fallback', questionSet, error: 'session budget exhausted' });
      throw new JevError('JEV session budget exhausted; optional call skipped', 'budget');
    }
    const safeState = redactValue(state);
    const serialized = JSON.stringify(safeState);
    if (serialized.length > this.config.limits.maxStateChars) throw new JevError(`state of ${serialized.length} chars exceeds maxStateChars`, 'size');
    const stateHash = hashValue(safeState);
    const key = this.cache.key({ model: this.config.jevModel, state: safeState, questions, questionSetVersion: version, policyVersion: POLICY_VERSION });
    const cached = this.cache.get(key);
    if (cached) {
      const meta = { latencyMs: 0, cached: true, inputTokens: 0, outputTokens: 0, costUsd: 0, model: this.config.jevModel, questionSet, questionSetVersion: version, ...(cached.responseId ? { responseId: cached.responseId } : {}) };
      this.telemetry.recordDecision(this.sessionId, meta, stateHash);
      return { answers: cached.answers, meta };
    }
    const started = this.now();
    try {
      const response = await this.client.decide({ model: this.config.jevModel, state: safeState, questions });
      const inputTokens = response.usage?.input_tokens ?? Math.ceil(serialized.length / 4);
      const outputTokens = response.usage?.output_tokens ?? 0;
      const costUsd = response.usage?.cost ?? (inputTokens * this.config.pricing.inputUsdPerMillion + outputTokens * this.config.pricing.outputUsdPerMillion) / 1_000_000;
      const meta = { latencyMs: this.now() - started, cached: false, inputTokens, outputTokens, costUsd, model: response.model ?? this.config.jevModel, questionSet, questionSetVersion: version, ...(response.id ? { responseId: response.id } : {}) };
      this.cache.set(key, { answers: response.answers, inputTokens, outputTokens, costUsd, ...(response.id ? { responseId: response.id } : {}) });
      this.telemetry.recordDecision(this.sessionId, meta, stateHash);
      return { answers: response.answers, meta };
    } catch (error) {
      this.telemetry.record({ sessionId: this.sessionId, kind: 'failure', questionSet, questionSetVersion: version, model: this.config.jevModel, latencyMs: this.now() - started, error: describeError(error), stateHash });
      debugLog('runtime', `decision failed for ${questionSet}`, describeError(error));
      throw error;
    }
  }

  async analyzeTask(request: string, cwd?: string, repo?: unknown): Promise<TaskAnalysis> {
    const text = redactText(request).slice(0, this.config.limits.maxPromptChars);
    const repoInfo = repo ?? (cwd ? repoSummary(cwd) : undefined);
    const result = await this.decide(TASK_QUESTION_SET, TASK_QUESTION_SET_VERSION, { userRequest: text, repo: repoInfo ?? null }, taskAnalysisQuestions);
    const profile = mapTaskProfile(result.answers);
    const decision = decideStrategy(profile, this.config);
    if (decision.confidence === 'low') this.telemetry.record({ sessionId: this.sessionId, kind: 'fallback', questionSet: TASK_QUESTION_SET, error: 'low confidence' });
    const requirements = buildRequirementContract(text, profile, this.config.thresholds);
    return { profile, decision, requirements, meta: result.meta };
  }

  /** Ranks a bounded, caller-supplied candidate list. Output paths are always a subset of input paths. */
  async rankContext(task: string, candidates: readonly ContextCandidate[]): Promise<{ ranked: RankedCandidate[]; calls: number }> {
    const bounded = candidates.slice(0, this.config.limits.maxCandidateFiles).map((c) => ({
      path: c.path,
      summary: c.summary.slice(0, 400),
      ...(c.role ? { role: c.role } : {}),
      ...(c.excerpt ? { excerpt: c.excerpt.slice(0, this.config.limits.maxExcerptChars) } : {}),
    }));
    const ranked: RankedCandidate[] = [];
    let calls = 0;
    const batchSize = Math.max(1, this.config.limits.contextBatchSize);
    for (let start = 0; start < bounded.length; start += batchSize) {
      const batch = bounded.slice(start, start + batchSize);
      const result = await this.decide(CONTEXT_QUESTION_SET, CONTEXT_QUESTION_SET_VERSION, { task: redactText(task).slice(0, 4000), candidates: batch }, contextQuestions(batch.length));
      calls += 1;
      ranked.push(...rankCandidates(batch, result.answers, this.config));
    }
    const sorted = ranked.sort((a, b) => b.relevance - a.relevance);
    this.telemetry.record({ sessionId: this.sessionId, kind: 'context', contextCandidates: bounded.length, contextSelected: sorted.filter((r) => r.band !== 'fallback').length });
    return { ranked: sorted, calls };
  }

  async discoverAndRank(task: string, cwd: string): Promise<{ discovery: DiscoveryResult; ranked: RankedCandidate[] }> {
    const discovery = discoverCandidates(task, cwd, this.config);
    if (!discovery.candidates.length) return { discovery, ranked: [] };
    const { ranked } = await this.rankContext(task, discovery.candidates);
    return { discovery, ranked };
  }

  async reviewCompletion(input: CompletionReviewInput): Promise<{ verdict: CompletionVerdict; meta: DecisionResult['meta'] }> {
    const cap = this.config.limits.maxChangedFilesInReview;
    const requirements = input.requirements.slice(0, 12);
    const state = {
      request: redactText(input.request).slice(0, 6000),
      requirements: requirements.map((r) => ({ id: r.id, text: r.text, source: r.source, severity: r.severity, verification: r.verification })),
      changes: {
        created: input.changes.created.slice(0, cap),
        modified: input.changes.modified.slice(0, cap),
        deleted: input.changes.deleted.slice(0, cap),
        testFiles: input.changes.testFiles.slice(0, cap),
        migrationFiles: input.changes.migrationFiles.slice(0, cap),
        configFiles: input.changes.configFiles.slice(0, cap),
        securitySensitiveFiles: input.changes.securityFiles.slice(0, cap),
      },
      tests: input.tests.slice(-10).map((t) => ({ command: redactText(t.command).slice(0, 300), outcome: t.outcome })),
      claim: redactText(input.claim).slice(0, 4000),
    };
    const questions = { ...completionQuestions, ...requirementCoverageQuestions(requirements.length) };
    const result = await this.decide(COMPLETION_QUESTION_SET, COMPLETION_QUESTION_SET_VERSION, state, questions, { optional: this.config.mode !== 'strict' });
    const verdict = evaluateCompletion(result.answers, requirements, this.config, input.testEvidenceExpected);
    return { verdict, meta: result.meta };
  }

  /** Builds review input from persisted hook state, so MCP/CLI reviews match automatic ones. */
  reviewInputFromSession(session: SessionState, claim: string): CompletionReviewInput | undefined {
    if (!session.request || totalChangedFiles(session) === 0) return undefined;
    const testEvidenceExpected = (session.profile?.testsRequired ?? 0) >= this.config.thresholds.testsRequired || session.requirements.some((r) => r.verification === 'tests');
    return { request: session.request, requirements: session.requirements, changes: session.changes, tests: session.tests, claim, testEvidenceExpected };
  }

  /** Deterministic classification first; JEV only supplements high-impact, ambiguous actions. */
  async assessToolAction(toolName: string, toolInput: Record<string, unknown>, cwd?: string, task?: string): Promise<ToolDecision> {
    const deterministic = classifyToolAction(toolName, toolInput, cwd);
    const strict = this.config.mode === 'strict';
    if (deterministic.hardDeny) {
      return { deterministic, action: strict ? 'deny' : 'ask', reason: `JEV Copilot hard rule: ${deterministic.reasons.join('; ')}` };
    }
    if (!this.config.toolGovernanceEnabled) return { deterministic, action: 'none', reason: 'tool governance disabled' };
    if (deterministic.requireConfirmation && this.config.thresholds.tool.askOnDestructive) {
      this.telemetry.record({ sessionId: this.sessionId, kind: 'tool_escalation' });
      return { deterministic, action: 'ask', reason: `JEV Copilot: ${deterministic.reasons.join('; ')}` };
    }
    if (deterministic.category !== 'high' || !this.enabled) return { deterministic, action: 'none', reason: `${deterministic.category}: no semantic review needed` };

    try {
      const result = await this.decide(TOOL_QUESTION_SET, TOOL_QUESTION_SET_VERSION, { action: deterministic.state, task: task ? redactText(task).slice(0, 2000) : null, deterministic: { category: deterministic.category, reasons: deterministic.reasons } }, toolActionQuestions);
      const impact = choice(result.answers, 'impact');
      const taskRelevant = noul(result.answers, 'task_relevant') ?? 1;
      const requiresHuman = noul(result.answers, 'requires_human_confirmation') ?? 0;
      const jev = { impact: impact?.choice ?? 'unknown', impactConfidence: impact?.confidence ?? 0, taskRelevant, requiresHumanConfirmation: requiresHuman };
      const t = this.config.thresholds.tool;
      const reasons: string[] = [];
      if (impact?.choice === 'destructive') reasons.push(`JEV rates this action destructive (${Math.round(jev.impactConfidence * 100)}%)`);
      if (taskRelevant < t.askWhenTaskRelevantBelow) reasons.push(`action looks unrelated to the current task (${Math.round(taskRelevant * 100)}% relevant)`);
      if (requiresHuman > t.askWhenHumanConfirmationAbove) reasons.push(`JEV recommends human confirmation (${Math.round(requiresHuman * 100)}%)`);
      if (reasons.length) {
        this.telemetry.record({ sessionId: this.sessionId, kind: 'tool_escalation' });
        return { deterministic, jev, action: 'ask', reason: `JEV Copilot: ${deterministic.reasons.join('; ')}. ${reasons.join('; ')}.` };
      }
      return { deterministic, jev, action: 'none', reason: 'high-impact action judged task-relevant' };
    } catch (error) {
      // Fail open for advisory governance; strict mode asks the user instead of guessing.
      return { deterministic, action: strict ? 'ask' : 'none', reason: `JEV unavailable (${describeError(error)}); ${strict ? 'strict mode requires confirmation' : 'deferring to normal permissions'}` };
    }
  }

  async status(checkApi: boolean): Promise<StatusReport> {
    const session = loadSession(this.sessionId);
    const report: StatusReport = {
      mode: this.config.mode,
      model: this.config.jevModel,
      endpointHost: new URL(this.config.endpoint).hostname,
      keyConfigured: this.client.configured,
      api: this.client.configured ? 'not-checked' : 'not-configured',
      completionReview: this.config.completionReviewEnabled,
      toolGovernance: this.config.toolGovernanceEnabled,
      sessionBudgetUsd: this.config.sessionBudgetUsd,
      configSources: this.config.sources,
      session: { id: session.sessionId, changedFiles: totalChangedFiles(session), requirements: session.requirements.length, repairs: session.repairCount, ...(session.profile ? { taskType: session.profile.taskType } : {}) },
      stats: this.stats(),
    };
    if (checkApi && this.client.configured && this.config.mode !== 'off') {
      try {
        await this.decide('connectivity', '1.0.0', { ping: 'JEV Copilot connectivity check' }, { reachable: { type: 'noul', instructions: 'Is `ping` a connectivity check message?' } }, { optional: false });
        report.api = 'connected';
      } catch (error) {
        report.api = 'error';
        report.apiDetail = describeError(error);
      }
    }
    return report;
  }

  thresholdsForMode(): ReturnType<typeof completionThresholds> {
    return completionThresholds(this.config);
  }
}

export { loadSession, saveSession };
