import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, pluginRoot } from './core/config.js';
import { contextSummary } from './policy/context-rank.js';
import { renderVerdict } from './policy/completion.js';
import { profileContext, profileSummaryLine } from './policy/task-profile.js';
import { classifyToolAction } from './policy/tool-risk.js';
import { currentSessionId, loadSession, Runtime } from './runtime/index.js';
import { redactTextDetailed } from './security/redact.js';
import { runYouTube, YOUTUBE_HELP } from './cli-youtube.js';
import { CONFIGURE_HELP, runConfigure } from './cli-configure.js';

const HELP = `JEV Copilot CLI (shares runtime, cache and telemetry with the plugin hooks)

  status                 configuration + connectivity check + session stats
${CONFIGURE_HELP}
  analyze "<task>"       JEV task profile and strategy for a task
  context "<task>"       discover + rank repository context for a task (run inside the repo)
  review ["<claim>"]     completion review using the current hooked session state
  assess <tool> <json>   deterministic tool-risk classification, e.g. assess Bash '{"command":"rm -rf /"}'
  stats                  session telemetry
  eval                   run tests/evals/cases.jsonl against live JEV and report accuracy
  redact <file>          show how many secrets the outbound redactor would mask in a file

YouTube mass research (needs yt-dlp; transcripts only, never media):
${YOUTUBE_HELP}
`;

function printStatus(report: Awaited<ReturnType<Runtime['status']>>): void {
  const lines = [
    'JEV Copilot',
    `Mode: ${report.mode}`,
    'Provider: OpenRouter',
    `Model: ${report.model}`,
    `API: ${report.api}${report.apiDetail ? ` (${report.apiDetail})` : ''}`,
    `Key configured: ${report.keyConfigured ? `yes (${report.keySource})` : 'no — run: node dist/src/cli.js configure'}`,
    `Completion review: ${report.completionReview ? 'enabled' : 'disabled'}`,
    `Tool governance: ${report.toolGovernance ? 'high-impact only' : 'hard rules only'}`,
    `Session budget: $${report.sessionBudgetUsd}`,
    `Config sources: ${report.configSources.join(' < ')}`,
  ];
  if (report.session) lines.push(`Session: ${report.session.id} (task: ${report.session.taskType ?? 'n/a'}, changed files: ${report.session.changedFiles}, requirements: ${report.session.requirements}, repairs: ${report.session.repairs})`);
  const s = report.stats;
  lines.push(`Calls: ${s.calls} (${s.cachedCalls} cached), failures: ${s.failures}, avg latency: ${s.avgLatencyMs}ms, est. cost: $${s.estimatedCostUsd}`);
  console.log(lines.join('\n'));
}

interface EvalCase {
  id: string;
  request: string;
  expected: { taskType?: string; testsRequired?: boolean; securitySensitive?: boolean; crossFileScope?: boolean };
}

async function runEval(runtime: Runtime): Promise<number> {
  const file = join(pluginRoot(), 'tests', 'evals', 'cases.jsonl');
  const cases = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EvalCase);
  const t = runtime.config.thresholds;
  let checks = 0;
  let correct = 0;
  const rows: string[] = [];
  for (const c of cases) {
    const { profile, meta } = await runtime.analyzeTask(c.request);
    const results: string[] = [];
    const judge = (name: string, actual: boolean | string, expected: boolean | string | undefined): void => {
      if (expected === undefined) return;
      checks += 1;
      const ok = actual === expected;
      if (ok) correct += 1;
      results.push(`${name}=${String(actual)}${ok ? '' : `(expected ${String(expected)})`}`);
    };
    judge('type', profile.taskType, c.expected.taskType);
    judge('tests', profile.testsRequired >= t.testsRequired, c.expected.testsRequired);
    judge('security', profile.securitySensitive >= t.securitySensitive, c.expected.securitySensitive);
    judge('crossFile', profile.crossFileScope >= t.crossFileScope, c.expected.crossFileScope);
    rows.push(`${c.id}: ${results.join(', ')} [${meta.cached ? 'cached' : `${meta.latencyMs}ms`}, ${meta.inputTokens} tok]`);
  }
  console.log(rows.join('\n'));
  console.log(`\nAccuracy: ${correct}/${checks} (${checks ? Math.round((correct / checks) * 100) : 0}%) over ${cases.length} cases`);
  return checks && correct / checks >= 0.75 ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const config = loadConfig(process.env, process.cwd());
  const runtime = new Runtime(config, currentSessionId());
  switch (command) {
    case 'status':
      printStatus(await runtime.status(true));
      return 0;
    case 'analyze': {
      const task = rest.join(' ').trim();
      if (!task) throw new Error('analyze requires task text');
      const analysis = await runtime.analyzeTask(task, process.cwd());
      console.log(profileSummaryLine(analysis.profile, analysis.decision));
      console.log(profileContext(analysis.profile, analysis.decision));
      console.log(`\nRequirement contract:\n${analysis.requirements.map((r) => `- ${r.id} [${r.source}/${r.severity}/${r.verification}] ${r.text}`).join('\n')}`);
      console.log(`\n(${analysis.meta.cached ? 'cached' : `${analysis.meta.latencyMs}ms`}, ${analysis.meta.inputTokens} input tokens, $${analysis.meta.costUsd.toFixed(6)})`);
      return 0;
    }
    case 'context': {
      const task = rest.join(' ').trim();
      if (!task) throw new Error('context requires task text');
      const { discovery, ranked } = await runtime.discoverAndRank(task, process.cwd());
      console.log(`keywords: ${discovery.keywords.join(', ')}\ntracked files: ${discovery.totalTracked}, candidates: ${discovery.candidates.length}`);
      console.log(ranked.length ? contextSummary(ranked) : 'No candidates found.');
      return 0;
    }
    case 'review': {
      const session = loadSession(runtime.sessionId);
      const input = runtime.reviewInputFromSession(session, rest.join(' '));
      if (!input) {
        console.log('No reviewable session state (no analyzed request or no tracked changes).');
        return 1;
      }
      const { verdict } = await runtime.reviewCompletion(input);
      console.log(renderVerdict(verdict));
      return verdict.decision === 'pass' ? 0 : 2;
    }
    case 'assess': {
      const [tool, json] = rest;
      if (!tool || !json) throw new Error('assess requires <tool> <json-input>');
      const assessment = classifyToolAction(tool, JSON.parse(json) as Record<string, unknown>, process.cwd());
      console.log(JSON.stringify(assessment, null, 2));
      return 0;
    }
    case 'stats':
      console.log(JSON.stringify(runtime.stats(), null, 2));
      return 0;
    case 'eval':
      return runEval(runtime);
    case 'youtube':
    case 'yt':
      return runYouTube(rest, runtime);
    case 'configure':
    case 'config':
      return runConfigure(rest);
    case 'redact': {
      const [file] = rest;
      if (!file) throw new Error('redact requires a file path');
      const { redactions } = redactTextDetailed(readFileSync(file, 'utf8'));
      console.log(`${redactions} redaction(s) would be applied to ${file}`);
      return 0;
    }
    default:
      console.log(HELP);
      return command ? 1 : 0;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
