import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/core/config.js';
import { credentialsFile, isOpenRouterKeyShape, readStoredKey, removeStoredKey, writeStoredKey } from '../src/core/credentials.js';
import { FAKE_KEY } from './helpers.js';
describe('credentials file', () => {
    const env = () => ({ JEV_COPILOT_CREDENTIALS_FILE: join(mkdtempSync(join(tmpdir(), 'jev-cred-')), 'nested', 'credentials.json') });
    it('validates the key shape without leaking it', () => {
        assert.ok(isOpenRouterKeyShape(FAKE_KEY));
        assert.ok(!isOpenRouterKeyShape('sk-proj-notopenrouter'));
        assert.ok(!isOpenRouterKeyShape(''));
        assert.throws(() => writeStoredKey('nope', env()), /does not look like an OpenRouter key/);
    });
    it('writes, reads and removes the key at the configured path', () => {
        const e = env();
        assert.equal(readStoredKey(e), undefined);
        const file = writeStoredKey(` ${FAKE_KEY}\n`, e);
        assert.equal(file, credentialsFile(e));
        assert.ok(existsSync(file));
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).openrouterApiKey, FAKE_KEY);
        assert.equal(readStoredKey(e), FAKE_KEY);
        assert.ok(removeStoredKey(e));
        assert.ok(!removeStoredKey(e));
        assert.equal(readStoredKey(e), undefined);
    });
    it('is the lowest-precedence key source in loadConfig and never overrides env or plugin config', () => {
        const e = env();
        const cwd = mkdtempSync(join(tmpdir(), 'jev-cwd-'));
        assert.equal(loadConfig({ ...e }, cwd).keySource, 'none');
        writeStoredKey(FAKE_KEY, e);
        const fromFile = loadConfig({ ...e }, cwd);
        assert.equal(fromFile.apiKey, FAKE_KEY);
        assert.equal(fromFile.keySource, 'credentials-file');
        assert.ok(fromFile.sources.includes('credentials-file'));
        const other = FAKE_KEY.replace('testkey', 'envkey0');
        assert.equal(loadConfig({ ...e, OPENROUTER_API_KEY: other }, cwd).keySource, 'environment');
        assert.equal(loadConfig({ ...e, OPENROUTER_API_KEY: other }, cwd).apiKey, other);
        assert.equal(loadConfig({ ...e, CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY: other }, cwd).keySource, 'plugin-config');
        assert.equal(loadConfig({ ...e, CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY: '${user_config.openrouter_api_key}' }, cwd).keySource, 'credentials-file', 'unset plugin placeholder falls through');
    });
});
