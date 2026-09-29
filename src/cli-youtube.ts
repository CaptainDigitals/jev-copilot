import { writeFileSync } from 'node:fs';
import { parseJobOptions, renderOutcome } from './mcp/youtube-tools.js';
import type { Runtime } from './runtime/index.js';
import { citation } from './youtube/deep.js';
import { YouTubeResearchEngine } from './youtube/engine.js';
import { renderCostEstimate } from './youtube/report.js';

export const YOUTUBE_HELP = `  youtube analyze <url|id> [--question "..."]        one video, deep by default
  youtube playlist <url> [options]                   every video of a playlist or channel
  youtube research "<topic>" [urls...] [options]     topic search + screening + routing + report
  youtube compare <url> <url> [...] [options]        comparison task across given videos
  youtube parts <url> [...]                          parts/components extraction task
  youtube steps <url> [...]                          procedure extraction task
  youtube status [jobId]                             job list or one job with its estimate
  youtube resume <jobId> [--yes]                     continue an interrupted / over-budget job
  youtube export <jobId> [--synthesis file.md] [--out file]   merge a synthesis and write report
  youtube ask <jobId|collection> "<question>"        follow-up question over stored transcripts
  options: --mode fast|standard|deep|audit  --task research|analyze|compare|parts|steps
           --max N  --top N  --all  --no-dedupe  --budget USD  --deep-model id|claude-session
           --collection name  --question "..."  --yes (proceed over budget)`;

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (['all', 'no-dedupe', 'yes'].includes(name) || next === undefined || next.startsWith('--')) flags[name] = true;
    else {
      flags[name] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

function optionsFromFlags(flags: Record<string, string | boolean>, task: string): Record<string, unknown> {
  const num = (v: string | boolean | undefined): number | undefined => (typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    task,
    mode: flags.mode,
    maxVideos: num(flags.max),
    top: num(flags.top),
    budgetUsd: num(flags.budget),
    deepModel: flags['deep-model'],
    collection: flags.collection,
    analyzeAll: flags.all === true || undefined,
    dedupe: flags['no-dedupe'] === true ? false : undefined,
  };
}

export async function runYouTube(rest: readonly string[], runtime: Runtime, out: (line: string) => void = console.log): Promise<number> {
  const [sub, ...args] = rest;
  const { positional, flags } = parseArgs(args);
  const engine = new YouTubeResearchEngine(runtime, { onProgress: (line) => console.error(`  ${line}`) });
  const question = typeof flags.question === 'string' ? flags.question : undefined;
  const research = async (task: string, inputs: string[], overrides: Record<string, unknown> = {}): Promise<number> => {
    if (!inputs.length) throw new Error(`youtube ${sub} requires at least one URL, id or topic`);
    const outcome = await engine.run({ inputs, ...parseJobOptions({ ...optionsFromFlags(flags, task), ...overrides }), ...(question ? { question } : {}), confirmOverBudget: flags.yes === true });
    out(renderOutcome(outcome));
    return outcome.overBudget ? 3 : 0;
  };
  switch (sub) {
    case 'analyze':
      return research('analyze', positional.slice(0, 1), { analyzeAll: true, maxVideos: 1 });
    case 'playlist':
      return research('research', positional);
    case 'research':
      return research('research', positional);
    case 'compare':
      return research('compare', positional, { analyzeAll: true });
    case 'parts':
      return research('parts', positional, { analyzeAll: true });
    case 'steps':
      return research('steps', positional, { analyzeAll: true });
    case 'status': {
      const [jobId] = positional;
      if (!jobId) {
        const jobs = engine.store.listJobs(20);
        out(jobs.length ? jobs.map((j) => `${j.jobId} · ${j.state} · ${j.videoOrder.length} videos · ${j.question.slice(0, 80)}`).join('\n') : 'No research jobs yet.');
        return 0;
      }
      const job = engine.store.loadJob(jobId);
      if (!job) throw new Error(`unknown job ${jobId}`);
      out(`${job.jobId} · ${job.state} · ${job.question}\n${renderCostEstimate(engine.estimate(job))}${job.error ? `\nError: ${job.error}` : ''}`);
      return 0;
    }
    case 'resume': {
      const [jobId] = positional;
      if (!jobId) throw new Error('resume requires a job id');
      const outcome = await engine.resume(jobId, flags.yes === true);
      out(renderOutcome(outcome));
      return outcome.overBudget ? 3 : 0;
    }
    case 'export': {
      const [jobId] = positional;
      if (!jobId) throw new Error('export requires a job id');
      const synthesis = typeof flags.synthesis === 'string' ? (await import('node:fs')).readFileSync(flags.synthesis, 'utf8') : undefined;
      const paths = engine.refreshReport(jobId, synthesis);
      if (typeof flags.out === 'string') {
        writeFileSync(flags.out, engine.store.getArtifact(jobId, flags.out.endsWith('.json') ? 'report.json' : 'report.md') ?? '', 'utf8');
        out(`Report copied to ${flags.out}`);
      } else out(`Report: ${paths.reportPath}\nJSON: ${paths.jsonPath}`);
      return 0;
    }
    case 'ask': {
      const [target, ...q] = positional;
      const text = q.join(' ').trim();
      if (!target || !text) throw new Error('ask requires <jobId|collection> "<question>"');
      const result = await engine.ask(target, text);
      out(result.answers.length ? result.answers.map((a) => `(${a.score.toFixed(1)}/3) ${a.title} ${citation(a.chunk)}\n  ${a.chunk.text.slice(0, 500)}`).join('\n\n') : 'No transcript chunks matched the question keywords.');
      return 0;
    }
    default:
      out(YOUTUBE_HELP);
      return sub ? 1 : 0;
  }
}
