import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { Runtime } from '../src/runtime/index.js';
import { DecisionCache } from '../src/jev/cache.js';
import { Telemetry } from '../src/state/telemetry.js';
/** Assembled at runtime so no provider-shaped token exists on disk. */
export const FAKE_KEY = ['sk-or', 'v1', 'testkey'.repeat(6) + '0123456789'].join('-');
export function isolateDataDir() {
    const dir = mkdtempSync(join(tmpdir(), 'jev-copilot-test-'));
    process.env.JEV_COPILOT_DATA_DIR = dir;
    return dir;
}
export function testConfig(overrides = {}, env = {}) {
    const base = loadConfig({ OPENROUTER_API_KEY: FAKE_KEY, ...env }, mkdtempSync(join(tmpdir(), 'jev-cwd-')));
    return { ...base, ...overrides, cache: { enabled: false, ttlSeconds: 0 } };
}
/** Builds a Decisions API body from the questions asked, honouring per-question overrides. */
export function fakeAnswers(questions, overrides = {}, defaults = {}) {
    const answers = {};
    for (const [id, q] of Object.entries(questions)) {
        const o = overrides[id];
        if (q.type === 'noul')
            answers[id] = { type: 'noul', noul: typeof o === 'number' ? o : (defaults.noul ?? 0.2) };
        else if (q.type === 'choice') {
            const keys = Object.keys(q.criteria);
            const pick = typeof o === 'string' && keys.includes(o) ? o : (keys[0] ?? '');
            const probabilities = Object.fromEntries(keys.map((k) => [k, k === pick ? 0.95 : 0.05 / Math.max(1, keys.length - 1)]));
            answers[id] = { type: 'choice', choice: pick, probabilities, confidence: 0.95 };
        }
        else {
            const value = typeof o === 'number' ? o : (defaults.score ?? 1);
            const levels = q.criteria.length;
            const probabilities = Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), i === Math.round(value) ? 0.9 : 0.1 / Math.max(1, levels - 1)]));
            answers[id] = { type: 'score', score: value, probabilities, confidence: 0.9 };
        }
    }
    return answers;
}
export function fakeFetch(options = {}) {
    const failures = [...(options.failWith ?? [])];
    const impl = (async (_url, init) => {
        impl.calls += 1;
        const body = JSON.parse(String(init?.body ?? '{}'));
        options.onRequest?.(body);
        if (options.hang) {
            await new Promise((resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            });
        }
        const status = failures.shift();
        if (status)
            return new Response(JSON.stringify({ error: { message: 'failure' } }), { status, headers: status === 429 ? { 'retry-after': '0' } : {} });
        if (options.malformed)
            return new Response('{"answers": {"nope": 1}}', { status: 200, headers: { 'content-type': 'application/json' } });
        const questions = body.questions;
        const payload = { id: 'gen-dec-test', model: 'typesafe/jev-1.13-test', provider: 'TypeSafe', answers: fakeAnswers(questions, options.overrides, options.defaults), usage: { input_tokens: 300, output_tokens: 20, cost: 0.0000126 } };
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    impl.calls = 0;
    return impl;
}
export function testRuntime(sessionId, fetchOptions = {}, configOverrides = {}) {
    const dir = isolateDataDir();
    const config = testConfig(configOverrides);
    return new Runtime(config, sessionId, { fetchImpl: fakeFetch(fetchOptions), telemetry: new Telemetry(true, join(dir, 'telemetry.jsonl')), cache: new DecisionCache(false, 0, dir) });
}
