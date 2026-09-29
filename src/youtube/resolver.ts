import { existsSync, readFileSync } from 'node:fs';
import type { ResolvedSource } from './types.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
/** Eleven URL-safe characters; a leading dash is rejected so a bare id can never look like an option. */
const VIDEO_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{10}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{9,63}$/;
const COLLECTION_NAME = /^[a-z0-9][a-z0-9-]{1,63}$/i;
const MAX_QUERY_CHARS = 200;

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

export function videoUrl(videoId: string, seconds?: number): string {
  return `https://www.youtube.com/watch?v=${videoId}${seconds !== undefined ? `&t=${Math.max(0, Math.floor(seconds))}s` : ''}`;
}

/** Parses one YouTube URL into a canonical source, or undefined when it is not a YouTube URL. */
export function parseYouTubeUrl(input: string): ResolvedSource | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return undefined;

  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return isVideoId(id) ? { kind: 'video', value: videoUrl(id), videoIds: [id] } : undefined;
  }
  const list = url.searchParams.get('list');
  const v = url.searchParams.get('v');
  if (url.pathname === '/playlist' && list && PLAYLIST_ID.test(list)) {
    return { kind: 'playlist', value: `https://www.youtube.com/playlist?list=${list}`, videoIds: [] };
  }
  if (url.pathname === '/watch' && v && isVideoId(v)) return { kind: 'video', value: videoUrl(v), videoIds: [v] };
  const shorts = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  if (shorts?.[1]) return { kind: 'video', value: videoUrl(shorts[1]), videoIds: [shorts[1]] };
  const channel = /^\/(@[A-Za-z0-9._-]{2,60}|channel\/UC[A-Za-z0-9_-]{20,}|c\/[A-Za-z0-9._-]{2,60}|user\/[A-Za-z0-9._-]{2,60})\/?(?:videos)?\/?$/.exec(url.pathname);
  if (channel?.[1]) return { kind: 'channel', value: `https://www.youtube.com/${channel[1]}/videos`, videoIds: [] };
  return undefined;
}

/** Sanitizes free text for use as a yt-dlp search query: printable characters only, bounded length, no leading dash. */
export function sanitizeQuery(text: string): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
  return cleaned.replace(/^-+/, '');
}

function fromFile(path: string): ResolvedSource[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const out: ResolvedSource[] = [];
  for (const line of lines) {
    const parsed = parseYouTubeUrl(line) ?? (isVideoId(line) ? { kind: 'video' as const, value: videoUrl(line), videoIds: [line] } : undefined);
    if (parsed) out.push(parsed);
  }
  return out;
}

export interface ResolveOptions {
  collection?: string;
  cwd?: string;
}

/**
 * Turns user input (URLs, ids, a topic, a URL file, or a collection name) into typed sources.
 * Unknown URLs are rejected rather than passed to yt-dlp; free text becomes a sanitized search.
 */
export function resolveSources(inputs: readonly string[], options: ResolveOptions = {}): ResolvedSource[] {
  const sources: ResolvedSource[] = [];
  const freeText: string[] = [];
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;
    const parsed = parseYouTubeUrl(input);
    if (parsed) {
      sources.push(parsed);
      continue;
    }
    if (isVideoId(input) && !/\s/.test(input) && !existsSync(input)) {
      sources.push({ kind: 'video', value: videoUrl(input), videoIds: [input] });
      continue;
    }
    if (/\.(?:txt|list|urls)$/i.test(input) && existsSync(input)) {
      sources.push({ kind: 'file', value: input, videoIds: fromFile(input).flatMap((s) => s.videoIds) }, ...fromFile(input).filter((s) => s.kind !== 'video'));
      continue;
    }
    if (/^https?:\/\//i.test(input)) throw new Error(`Not a supported YouTube URL: ${input.slice(0, 80)}`);
    freeText.push(input);
  }
  if (freeText.length) {
    const query = sanitizeQuery(freeText.join(' '));
    if (query) sources.push({ kind: 'search', value: query, videoIds: [] });
  }
  if (options.collection) {
    if (!COLLECTION_NAME.test(options.collection)) throw new Error('Collection names are 2-64 letters, digits or dashes');
    sources.push({ kind: 'collection', value: options.collection, videoIds: [] });
  }
  if (!sources.length) throw new Error('No YouTube sources given (URL, video id, playlist, channel, topic text, or a .txt file of URLs)');
  return sources;
}
