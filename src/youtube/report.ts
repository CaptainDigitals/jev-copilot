import { videoUrl } from './resolver.js';
import { plainText, safeModelText, UNTRUSTED_NOTICE } from './untrusted.js';
import { formatTimestamp } from './transcript.js';
import type { CostEstimate, ResearchJob, VideoMetadata, VideoRecord } from './types.js';

export interface ReportInputs {
  job: ResearchJob;
  metadata: Map<string, VideoMetadata>;
  /** Per-video deep analyses (markdown) when a deep model ran. */
  analyses: Map<string, string>;
  /** Cross-source synthesis when a deep model ran; otherwise the bundle path is referenced. */
  synthesis?: string;
}

/** Link text safe inside a Markdown link and table cell: creator-controlled titles carry no syntax. */
function linkText(text: string, max = 70): string {
  return plainText(text, max) || 'untitled';
}

function rec(job: ResearchJob): VideoRecord[] {
  return job.videoOrder.map((id) => job.videos[id]).filter((v): v is VideoRecord => !!v);
}

function byValue(records: readonly VideoRecord[]): VideoRecord[] {
  return [...records].filter((v) => v.screening).sort((a, b) => (b.screening?.researchValue ?? 0) - (a.screening?.researchValue ?? 0));
}

export function corpusSummary(job: ResearchJob): string {
  const records = rec(job);
  const screened = records.filter((v) => v.screening);
  const routes = { deep: 0, focused: 0, index: 0, archive: 0 };
  for (const v of screened) if (v.screening) routes[v.screening.route] += 1;
  const rejected = records.filter((v) => v.status !== 'READY');
  return [
    `Videos discovered: ${job.metrics.videosDiscovered}`,
    `Videos with transcripts: ${records.filter((v) => v.status === 'READY').length}`,
    `Videos screened by JEV: ${screened.length}`,
    `Routing: ${routes.deep} deep, ${routes.focused} focused, ${routes.index} index, ${routes.archive} archive`,
    `Duplicates suppressed: ${records.filter((v) => v.duplicateOf).length}`,
    `Unavailable / no transcript: ${rejected.length}`,
    `Processing errors: ${job.metrics.processingErrors}`,
  ].join('\n');
}

/** Screening table used in reports and the bundle. */
export function screeningTable(job: ResearchJob, metadata: Map<string, VideoMetadata>, limit = 60): string {
  const rows = byValue(rec(job)).slice(0, limit).map((v) => {
    const s = v.screening;
    const m = metadata.get(v.videoId);
    if (!s) return '';
    return `| ${s.researchValue.toFixed(2)} | ${s.route} | [${linkText(m?.title ?? v.title ?? v.videoId)}](${videoUrl(v.videoId)}) | ${plainText(m?.channelName ?? v.channelName ?? '', 40)} | ${s.contentType} | ${s.relevance.toFixed(1)} | ${s.technicalDepth.toFixed(1)} | ${s.evidenceDensity.toFixed(1)} | ${s.promotionalIntensity.toFixed(1)}${v.duplicateOf ? ' · dup' : ''} |`;
  });
  return ['| Value | Route | Video | Channel | Type | Rel/4 | Depth/3 | Evid/2 | Promo/2 |', '|---|---|---|---|---|---|---|---|---|', ...rows.filter(Boolean)].join('\n');
}

export function renderCostEstimate(e: CostEstimate): string {
  return [
    'Research job estimate (values are estimates; provider pricing may vary)',
    `Videos: ${e.videos}`,
    `Transcript tokens: ${e.transcriptTokens.toLocaleString()}`,
    `JEV calls: ${e.jevCalls} (≈$${e.jevCostUsd.toFixed(4)})`,
    `Deep-analysis candidates: ${e.deepCandidates} (≈${e.deepInputTokens.toLocaleString()} input tokens${e.deepCostUsd === null ? ', cost depends on the deep model' : `, ≈$${e.deepCostUsd.toFixed(2)}`})`,
    `Estimated total: $${e.totalCostUsd.toFixed(4)}`,
  ].join('\n');
}

/** Final Markdown report (PRD §51). Sections without a deep model are filled from the evidence bundle by Claude. */
export function renderReport(inputs: ReportInputs): string {
  const { job, metadata } = inputs;
  const records = rec(job);
  const top = byValue(records).filter((v) => v.screening && v.screening.route !== 'archive');
  const low = byValue(records).filter((v) => v.screening && (v.screening.route === 'archive' || v.duplicateOf));
  const unavailable = records.filter((v) => v.status !== 'READY');
  const title = job.options.task === 'analyze' && records.length === 1 ? `Video analysis: ${linkText(metadata.get(records[0]?.videoId ?? '')?.title ?? job.question, 160)}` : `JEV Research: ${plainText(job.question, 200)}`;

  const lines: string[] = [
    `# ${title}`,
    '',
    `_Job ${job.jobId} · ${job.options.mode} mode · task ${job.options.task} · generated ${new Date().toISOString()}_`,
    '',
    '## Research Question',
    '',
    job.question,
    '',
    '## Corpus',
    '',
    corpusSummary(job),
    '',
    screeningTable(job, metadata),
    '',
  ];

  if (inputs.synthesis) {
    lines.push(safeModelText(inputs.synthesis.trim()), '');
  } else {
    lines.push('## Synthesis', '', `No headless deep model was configured; the cross-source synthesis is produced by Claude from the cited evidence bundle (${job.bundlePath ?? 'bundle.md'}) using the \`jev-research\` skill. Run \`/jev-copilot:youtube-export ${job.jobId}\` after Claude has written it to merge it here.`, '');
  }

  if (inputs.analyses.size) {
    lines.push('## Per-Source Deep Analyses', '', UNTRUSTED_NOTICE, '');
    for (const v of top) {
      const analysis = inputs.analyses.get(v.videoId);
      if (!analysis) continue;
      const m = metadata.get(v.videoId);
      lines.push(`### ${linkText(m?.title ?? v.videoId, 160)}`, '', `[${videoUrl(v.videoId)}](${videoUrl(v.videoId)}) · ${plainText(m?.channelName ?? '', 80)} · route ${v.screening?.route}`, '', safeModelText(analysis.trim()), '');
    }
  }

  lines.push('## Best Source Material', '');
  for (const v of top.slice(0, 15)) {
    const m = metadata.get(v.videoId);
    lines.push(`- [${linkText(m?.title ?? v.videoId, 200)}](${videoUrl(v.videoId)}) — ${plainText(m?.channelName ?? '', 80)}; value ${v.screening?.researchValue.toFixed(2)}, ${v.screening?.route}; ${v.screening?.reasonCodes.join(', ') || 'no flags'}`);
  }
  lines.push('', '## Low-Value / Duplicate Material', '');
  for (const v of low.slice(0, 30)) {
    const m = metadata.get(v.videoId);
    lines.push(`- [${linkText(m?.title ?? v.videoId, 200)}](${videoUrl(v.videoId)}) — ${v.duplicateOf ? `duplicate of ${v.duplicateOf}` : `value ${v.screening?.researchValue.toFixed(2)}`}`);
  }
  if (unavailable.length) {
    lines.push('', '## Sources Not Analyzed', '');
    for (const v of unavailable) lines.push(`- ${v.videoId}: ${v.status}${v.error ? ` (${v.error.slice(0, 120)})` : ''}`);
  }
  lines.push('', '## Source Index', '');
  for (const v of records) {
    const m = metadata.get(v.videoId);
    lines.push(`- ${v.videoId} · [${linkText(m?.title ?? v.title ?? 'untitled', 200)}](${videoUrl(v.videoId)}) · ${plainText(m?.channelName ?? '', 80)} · ${m ? formatTimestamp(m.durationSeconds) : ''} · transcript: ${v.transcriptSource ?? 'none'} · status ${v.status}`);
  }
  return lines.join('\n');
}

/** Structured export (PRD §35 export json). */
export function renderJson(inputs: ReportInputs): string {
  const { job, metadata } = inputs;
  return JSON.stringify(
    {
      job: { id: job.jobId, question: job.question, options: job.options, state: job.state, createdAt: job.createdAt, updatedAt: job.updatedAt, metrics: job.metrics, sources: job.sources },
      videos: rec(job).map((v) => ({ ...v, metadata: metadata.get(v.videoId) ?? null, deepAnalysis: inputs.analyses.get(v.videoId) ?? null })),
      synthesis: inputs.synthesis ?? null,
    },
    null,
    2,
  );
}
