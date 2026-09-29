import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debugLog, describeError } from '../core/logger.js';
import { isRecord } from '../core/config.js';
import { redactText } from '../security/redact.js';
import { parseYouTubeUrl, sanitizeQuery } from './resolver.js';

/**
 * Sandboxed yt-dlp wrapper. Rules (PRD §45): no shell, fixed argument allowlist, the user
 * value is always the final positional after `--`, URLs are re-validated, output goes to a
 * private temp directory with size caps, and errors are redacted.
 */

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type Runner = (command: string, args: string[], options: { cwd?: string; timeoutMs: number; maxBuffer: number }) => Promise<RunResult>;

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 8 * 1024 * 1024;

export const defaultRunner: Runner = (command, args, options) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: options.maxBuffer, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((error as { code: number }).code) : error ? 1 : 0;
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') + (error && !stderr ? describeError(error) : ''), code });
    });
  });

export interface YtDlpOptions {
  binary: string;
  timeoutMs: number;
  runner?: Runner;
}

export class YtDlp {
  private readonly runner: Runner;
  private availability?: Promise<{ ok: boolean; version?: string; detail?: string }>;

  constructor(private readonly options: YtDlpOptions) {
    this.runner = options.runner ?? defaultRunner;
  }

  /** Accepts either the configured binary or `python -m yt_dlp` as a fallback. */
  private async invoke(args: string[], cwd?: string, timeoutMs = this.options.timeoutMs): Promise<RunResult> {
    const base = ['--no-warnings', '--no-progress', '--no-call-home', '--no-playlist-reverse', '--ignore-config'];
    const first = await this.runner(this.options.binary, [...base, ...args], { ...(cwd ? { cwd } : {}), timeoutMs, maxBuffer: MAX_BUFFER });
    if (first.code === 0 || !/ENOENT|not recognized|not found/i.test(first.stderr)) return first;
    return this.runner('python', ['-m', 'yt_dlp', ...base, ...args], { ...(cwd ? { cwd } : {}), timeoutMs, maxBuffer: MAX_BUFFER });
  }

  available(): Promise<{ ok: boolean; version?: string; detail?: string }> {
    this.availability ??= this.runner(this.options.binary, ['--version'], { timeoutMs: 15000, maxBuffer: 1024 * 1024 })
      .then(async (r) => {
        if (r.code === 0) return { ok: true, version: r.stdout.trim() };
        const py = await this.runner('python', ['-m', 'yt_dlp', '--version'], { timeoutMs: 15000, maxBuffer: 1024 * 1024 });
        return py.code === 0 ? { ok: true, version: py.stdout.trim() } : { ok: false, detail: 'yt-dlp not found. Install with: python -m pip install -U yt-dlp' };
      })
      .catch((error) => ({ ok: false, detail: describeError(error) }));
    return this.availability;
  }

  private assertUrl(url: string): string {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) throw new Error('refusing to pass a non-YouTube URL to yt-dlp');
    return parsed.value;
  }

  /** Full metadata JSON for one video (`yt-dlp -J`). */
  async videoInfo(url: string): Promise<Record<string, unknown>> {
    const safe = this.assertUrl(url);
    const r = await this.invoke(['-J', '--skip-download', '--', safe]);
    if (r.code !== 0) throw new YtDlpError(classify(r.stderr), redactText(r.stderr).slice(0, 300));
    return parseJson(r.stdout);
  }

  /** Flat entries for a playlist or channel URL. */
  async listEntries(url: string, max: number): Promise<Record<string, unknown>[]> {
    const safe = this.assertUrl(url);
    const r = await this.invoke(['-J', '--flat-playlist', '--playlist-end', String(Math.max(1, max)), '--', safe], undefined, this.options.timeoutMs * 3);
    if (r.code !== 0) throw new YtDlpError(classify(r.stderr), redactText(r.stderr).slice(0, 300));
    const data = parseJson(r.stdout);
    return Array.isArray(data.entries) ? data.entries.filter(isRecord) : [];
  }

  /** Flat entries for a text search (`ytsearchN:`). The query is sanitized and never parsed as an option. */
  async search(query: string, max: number): Promise<Record<string, unknown>[]> {
    const q = sanitizeQuery(query);
    if (!q) return [];
    const r = await this.invoke(['-J', '--flat-playlist', '--', `ytsearch${Math.min(200, Math.max(1, max))}:${q}`], undefined, this.options.timeoutMs * 3);
    if (r.code !== 0) throw new YtDlpError(classify(r.stderr), redactText(r.stderr).slice(0, 300));
    const data = parseJson(r.stdout);
    return Array.isArray(data.entries) ? data.entries.filter(isRecord) : [];
  }

  /**
   * Downloads captions (json3) for a video into a temp dir and returns the parsed events.
   * `manual` selects creator captions; otherwise auto captions. Video media is never downloaded.
   */
  async captions(url: string, language: string, manual: boolean): Promise<{ events: unknown[]; language: string } | undefined> {
    const safe = this.assertUrl(url);
    const dir = mkdtempSync(join(tmpdir(), 'jev-yt-'));
    try {
      const lang = language.replace(/[^a-zA-Z-]/g, '').slice(0, 12) || 'en';
      // json3 is a native YouTube caption format; requesting it directly avoids any conversion step.
      const args = ['--skip-download', manual ? '--write-subs' : '--write-auto-subs', '--sub-langs', `${lang},-live_chat`, '--sub-format', 'json3', '-o', '%(id)s.%(ext)s', '--', safe];
      const r = await this.invoke(args, dir);
      const files = readdirSync(dir).filter((f) => f.endsWith('.json3'));
      if (!files.length) {
        // A clean exit with no file means the video has no captions of this kind. A failed exit is a
        // real error (rate limit, network, yt-dlp breakage) and must not be mistaken for "no captions".
        if (r.code !== 0) {
          const failure = classify(r.stderr);
          debugLog('ytdlp', 'caption fetch failed', redactText(r.stderr).slice(0, 300));
          if (failure !== 'UNAVAILABLE') throw new YtDlpError(failure, redactText(r.stderr).slice(0, 300));
        }
        return undefined;
      }
      const file = files.find((f) => f.endsWith(`.${lang}.json3`)) ?? files[0];
      if (!file) return undefined;
      const text = readFileSync(join(dir, file), 'utf8');
      if (Buffer.byteLength(text, 'utf8') > MAX_SUBTITLE_BYTES) throw new Error('caption file exceeds size limit');
      const data = parseJson(text);
      const events = Array.isArray(data.events) ? data.events : [];
      const detected = /\.([a-zA-Z-]+)\.json3$/.exec(file)?.[1] ?? lang;
      return { events, language: detected };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export type YtDlpFailure = 'PRIVATE' | 'DELETED' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'PROCESSING_FAILED';

export class YtDlpError extends Error {
  constructor(readonly failure: YtDlpFailure, detail: string) {
    super(`yt-dlp ${failure}: ${detail}`);
    this.name = 'YtDlpError';
  }
}

export function classify(stderr: string): YtDlpFailure {
  const s = stderr.toLowerCase();
  if (/private video|sign in to confirm your age|members-only|requires login/.test(s)) return 'PRIVATE';
  if (/video unavailable|has been removed|does not exist|no longer available|terminated/.test(s)) return 'DELETED';
  if (/429|too many requests|rate.?limit/.test(s)) return 'RATE_LIMITED';
  if (/unavailable|not available|premieres|is live|live event|unsupported url/.test(s)) return 'UNAVAILABLE';
  return 'PROCESSING_FAILED';
}

function parseJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error('yt-dlp returned non-object JSON');
  return parsed;
}
