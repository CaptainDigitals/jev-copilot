import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
/**
 * Persistent data directory. Claude Code supplies CLAUDE_PLUGIN_DATA for installed
 * plugins; development and CLI runs fall back to ~/.claude/jev-copilot.
 */
export function dataDir(env = process.env) {
    const dir = env.JEV_COPILOT_DATA_DIR || env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'jev-copilot');
    ensureDir(dir);
    return dir;
}
export function ensureDir(dir) {
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
}
export function sessionsDir(env) {
    const dir = join(dataDir(env), 'sessions');
    ensureDir(dir);
    return dir;
}
export function cacheDir(env) {
    const dir = join(dataDir(env), 'cache');
    ensureDir(dir);
    return dir;
}
export function telemetryFile(env) {
    return join(dataDir(env), 'telemetry.jsonl');
}
/** Session ids come from Claude Code; keep them filesystem-safe before use in a path. */
export function safeId(id) {
    const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96);
    return cleaned || 'default';
}
