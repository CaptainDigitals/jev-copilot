import { debugLog, describeError } from '../core/logger.js';
import { renderVerdict } from '../policy/completion.js';
import { profileContext, profileSummaryLine } from '../policy/task-profile.js';
import { classifyFileRole, normalizePath } from '../security/exclusions.js';
import { redactText } from '../security/redact.js';
import { loadSession, recordFileChange, recordTestEvidence, resetForNewTask, saveSession, totalChangedFiles, type TestEvidence } from '../state/session-store.js';
import type { Runtime } from '../runtime/index.js';
import type { HookInput, HookResult } from './types.js';

const TRIVIAL_PROMPT = /^(?:y(?:es)?|no?|ok(?:ay)?|thanks?(?: you)?|ty|continue|go(?: ahead)?|proceed|sure|do it|lgtm|looks good|next|done|stop|cancel|hi|hello)[.! ]*$/i;
const TEST_COMMAND = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnpx\s+(?:vitest|jest|mocha|playwright\s+test|ava|tap)\b|\bnode\s+--test\b|\bpytest\b|\bpython3?\s+-m\s+(?:pytest|unittest)\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b|\bmvn\s+(?:test|verify)\b|\bgradle(?:w)?\s+test\b|\bphpunit\b|\brspec\b|\bbundle\s+exec\s+rspec\b|\bctest\b|\bswift\s+test\b|\bflutter\s+test\b/i;
const DELETE_COMMAND = /\b(?:rm|del|Remove-Item|git\s+rm)\b\s+(?:-[A-Za-z-]+\s+)*["']?([^\s"';&|]+)/g;

function responseText(response: unknown): string {
  if (typeof response === 'string') return response;
  try {
    return JSON.stringify(response ?? '');
  } catch {
    return '';
  }
}

function testOutcome(text: string): TestEvidence['outcome'] {
  const t = text.slice(0, 20000);
  const failedCount = /\b[1-9]\d*\s+(?:failed|failing|failures?)\b/i.test(t);
  const failedMarker = /\bFAILED\b|[✗✖]|\b(?:tests? failed|error TS\d+|AssertionError|not ok \d+)\b/.test(t) || /"exit_code":\s*[1-9]/.test(t);
  if (failedCount || failedMarker) return 'fail';
  if (/\b(?:\d+\s+pass(?:ed|ing)?|all tests passed|ok\b.*\d+|✓|✔|Tests? passed|BUILD SUCCESS|0 failed)\b/i.test(t)) return 'pass';
  return 'unknown';
}

export function onSessionStart(runtime: Runtime, input: HookInput): HookResult {
  const sessionId = input.session_id ?? runtime.sessionId;
  const session = loadSession(sessionId);
  if (input.start_type === 'startup' || input.start_type === 'clear') saveSession({ ...session, changes: { created: [], modified: [], deleted: [], testFiles: [], migrationFiles: [], configFiles: [], securityFiles: [] }, tests: [], changeCount: 0, reviewedAtChangeCount: 0, repairCount: 0 });
  else saveSession(session);
  const cfg = runtime.config;
  if (cfg.mode === 'off') return undefined;
  const degraded = !runtime.client.configured;
  const lines = [
    `JEV Copilot is active (mode: ${cfg.mode}, model: ${cfg.jevModel}${degraded ? ', DEGRADED: no OpenRouter key configured' : ''}).`,
    degraded
      ? 'Automatic JEV analysis is disabled until an OpenRouter key is set via the plugin config or OPENROUTER_API_KEY. Normal Claude workflow continues.'
      : `JEV performs bounded typed judgments only; you still reason, plan and implement. Explicit tools: jev_analyze_task, jev_context, jev_rank_context, jev_review_completion, jev_assess_tool_action, jev_status, jev_session_stats (MCP server "jev"). Commands: /jev-copilot:status, :analyze, :plan, :context, :review, :stats, :config-help.`,
  ];
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
}

export async function onUserPrompt(runtime: Runtime, input: HookInput): Promise<HookResult> {
  const raw = typeof input.prompt === 'string' ? input.prompt : typeof input.user_input === 'string' ? input.user_input : '';
  const prompt = raw.trim();
  const cfg = runtime.config;
  if (cfg.mode === 'off' || !runtime.enabled) return undefined;
  if (prompt.length < cfg.limits.minPromptChars || prompt.startsWith('/') || TRIVIAL_PROMPT.test(prompt)) return undefined;
  const sessionId = input.session_id ?? runtime.sessionId;
  const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
  try {
    const analysis = await runtime.analyzeTask(prompt, cwd);
    const previous = loadSession(sessionId);
    const fresh = resetForNewTask(previous, redactText(prompt).slice(0, cfg.limits.maxPromptChars));
    saveSession({ ...fresh, profile: analysis.profile, strategy: analysis.decision, requirements: analysis.requirements });
    const context = cfg.mode === 'assist' ? profileContext(analysis.profile, analysis.decision) : `${profileContext(analysis.profile, analysis.decision)}\nRequirement contract (${analysis.requirements.length}): ${analysis.requirements.map((r) => `${r.id}${r.source === 'inferred' ? '*' : ''}`).join(', ')} (* = inferred by JEV, never overrides explicit items). Completion review will check these when you stop.`;
    return { systemMessage: profileSummaryLine(analysis.profile, analysis.decision), hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
  } catch (error) {
    debugLog('hook:prompt', 'analysis failed', describeError(error));
    return undefined;
  }
}

export async function onPreToolUse(runtime: Runtime, input: HookInput): Promise<HookResult> {
  if (runtime.config.mode === 'off' || typeof input.tool_name !== 'string') return undefined;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const session = loadSession(input.session_id ?? runtime.sessionId);
  const decision = await runtime.assessToolAction(input.tool_name, toolInput, typeof input.cwd === 'string' ? input.cwd : undefined, session.request);
  if (decision.action === 'none' || decision.action === 'allow') return undefined;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision.action, permissionDecisionReason: decision.reason } };
}

export function onPostToolUse(runtime: Runtime, input: HookInput): HookResult {
  if (runtime.config.mode === 'off' || typeof input.tool_name !== 'string') return undefined;
  const sessionId = input.session_id ?? runtime.sessionId;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const response = responseText(input.tool_response);
  let session = loadSession(sessionId);

  if (input.tool_name === 'Write' || input.tool_name === 'Edit' || input.tool_name === 'MultiEdit' || input.tool_name === 'NotebookEdit') {
    const path = typeof toolInput.file_path === 'string' ? toolInput.file_path : typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : '';
    if (path) {
      const rel = normalizePath(typeof input.cwd === 'string' && path.startsWith(input.cwd) ? path.slice(input.cwd.length) : path);
      const created = input.tool_name === 'Write' && /created/i.test(response);
      session = recordFileChange(session, rel, created ? 'created' : 'modified', classifyFileRole(rel));
    }
  } else if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    if (TEST_COMMAND.test(command)) {
      session = recordTestEvidence(session, { command: redactText(command).slice(0, 300), outcome: testOutcome(response), at: new Date().toISOString() });
    }
    for (const match of command.matchAll(DELETE_COMMAND)) {
      const target = match[1];
      if (target && !target.startsWith('-')) session = recordFileChange(session, normalizePath(target), 'deleted', classifyFileRole(target));
    }
  }
  saveSession(session);
  return undefined;
}

export async function onStop(runtime: Runtime, input: HookInput): Promise<HookResult> {
  const cfg = runtime.config;
  if (cfg.mode === 'off' || cfg.mode === 'assist' || !cfg.completionReviewEnabled) return undefined;
  const sessionId = input.session_id ?? runtime.sessionId;
  const session = loadSession(sessionId);
  if (!session.request || totalChangedFiles(session) === 0) return undefined;
  if (session.changeCount <= session.reviewedAtChangeCount) return undefined;
  if (session.repairCount >= cfg.limits.maxRepairLoops) {
    saveSession({ ...session, reviewedAtChangeCount: session.changeCount });
    return { systemMessage: `JEV review: repair cap (${cfg.limits.maxRepairLoops}) reached; manual review recommended.` };
  }
  if (!runtime.enabled) {
    return cfg.mode === 'strict' ? { systemMessage: 'JEV review unavailable (no key); strict mode requires manual review.' } : undefined;
  }
  const claim = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
  const reviewInput = runtime.reviewInputFromSession(session, claim);
  if (!reviewInput) return undefined;

  try {
    const { verdict } = await runtime.reviewCompletion(reviewInput);
    const rendered = renderVerdict(verdict);
    if (verdict.decision === 'pass') {
      saveSession({ ...session, reviewedAtChangeCount: session.changeCount, lastReviewDecision: 'pass' });
      return { systemMessage: `JEV review: pass (completeness ${verdict.implementationComplete.toFixed(2)}, tests ${verdict.testsSufficient.toFixed(2)}, regression ${Math.round(verdict.likelyRegression * 100)}%)` };
    }
    runtime.telemetry.record({ sessionId, kind: 'repair' });
    saveSession({ ...session, reviewedAtChangeCount: session.changeCount, repairCount: session.repairCount + 1, lastReviewDecision: 'repair' });
    const reason = `${rendered}\n\nRepair loop ${session.repairCount + 1}/${cfg.limits.maxRepairLoops}. Address only the listed deficiencies with repository evidence (edit, test, or cite the file that already satisfies the item). If a deficiency is mistaken, state precisely why in your final message. Do not restart the task.`;
    return { decision: 'block', reason, systemMessage: `JEV review: repair required (${verdict.deficiencies.length} item${verdict.deficiencies.length === 1 ? '' : 's'})`, hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason } };
  } catch (error) {
    debugLog('hook:stop', 'review failed', describeError(error));
    if (cfg.mode === 'strict') {
      saveSession({ ...session, reviewedAtChangeCount: session.changeCount, lastReviewDecision: 'manual-review' });
      return { systemMessage: 'JEV review unavailable; strict mode requires manual review before accepting this work.', hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'JEV completion review could not run. Tell the user explicitly that the change has not been independently reviewed.' } };
    }
    return undefined;
  }
}

export function onSessionEnd(runtime: Runtime, input: HookInput): HookResult {
  const sessionId = input.session_id ?? runtime.sessionId;
  const stats = runtime.stats();
  runtime.telemetry.record({ sessionId, kind: 'session_end', mode: runtime.config.mode, costUsd: stats.estimatedCostUsd, inputTokens: stats.estimatedInputTokens });
  return undefined;
}
