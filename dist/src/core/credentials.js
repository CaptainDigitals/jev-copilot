import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const KEY_SHAPE = /^sk-or-v1-[A-Za-z0-9_-]{32,}$/;
export function credentialsFile(env = process.env) {
    const override = env.JEV_COPILOT_CREDENTIALS_FILE?.trim();
    return override || join(homedir(), '.jev-copilot', 'credentials.json');
}
export function isOpenRouterKeyShape(value) {
    return KEY_SHAPE.test(value.trim());
}
export function readStoredKey(env = process.env) {
    const file = credentialsFile(env);
    if (!existsSync(file))
        return undefined;
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const key = typeof parsed === 'object' && parsed !== null ? parsed.openrouterApiKey : undefined;
        return typeof key === 'string' && isOpenRouterKeyShape(key) ? key.trim() : undefined;
    }
    catch {
        return undefined;
    }
}
export function writeStoredKey(key, env = process.env) {
    const trimmed = key.trim();
    if (!isOpenRouterKeyShape(trimmed))
        throw new Error('That does not look like an OpenRouter key (expected sk-or-v1-...). Nothing was saved.');
    const file = credentialsFile(env);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ openrouterApiKey: trimmed, savedAt: new Date().toISOString() }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    try {
        chmodSync(file, 0o600);
    }
    catch {
        // Windows ignores POSIX modes; the file lives under the user's profile, which is user-private by default.
    }
    return file;
}
export function removeStoredKey(env = process.env) {
    const file = credentialsFile(env);
    if (!existsSync(file))
        return false;
    rmSync(file, { force: true });
    return true;
}
