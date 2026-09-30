import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Plugin-owned credential store for people who cannot reach Claude Code's `/plugin` configure panel
 * (for example in the desktop app). One JSON file in the user's home directory, readable only by the
 * user where the platform supports modes, never inside a repository or the plugin directory.
 * Precedence stays: plugin user config / environment first, this file last.
 */

export type Env = Record<string, string | undefined>;
export type KeySource = 'plugin-config' | 'environment' | 'credentials-file' | 'none';

const KEY_SHAPE = /^sk-or-v1-[A-Za-z0-9_-]{32,}$/;

export function credentialsFile(env: Env = process.env): string {
  const override = env.JEV_COPILOT_CREDENTIALS_FILE?.trim();
  return override || join(homedir(), '.jev-copilot', 'credentials.json');
}

export function isOpenRouterKeyShape(value: string): boolean {
  return KEY_SHAPE.test(value.trim());
}

export function readStoredKey(env: Env = process.env): string | undefined {
  const file = credentialsFile(env);
  if (!existsSync(file)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const key = typeof parsed === 'object' && parsed !== null ? (parsed as { openrouterApiKey?: unknown }).openrouterApiKey : undefined;
    return typeof key === 'string' && isOpenRouterKeyShape(key) ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredKey(key: string, env: Env = process.env): string {
  const trimmed = key.trim();
  if (!isOpenRouterKeyShape(trimmed)) throw new Error('That does not look like an OpenRouter key (expected sk-or-v1-...). Nothing was saved.');
  const file = credentialsFile(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ openrouterApiKey: trimmed, savedAt: new Date().toISOString() }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file lives under the user's profile, which is user-private by default.
  }
  return file;
}

export function removeStoredKey(env: Env = process.env): boolean {
  const file = credentialsFile(env);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}
