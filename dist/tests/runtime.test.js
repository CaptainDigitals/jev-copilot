import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DecisionCache } from '../src/jev/cache.js';
import { Runtime } from '../src/runtime/index.js';
import { Telemetry } from '../src/state/telemetry.js';
import { discoverCandidates, extractKeywords } from '../src/context/discover.js';
import { fakeFetch, isolateDataDir, testConfig, testRuntime } from './helpers.js';
test('identical decisions hit the cache and cost nothing the second time', async () => {
    const dir = isolateDataDir();
    const fetchImpl = fakeFetch();
    const rt = new Runtime(testConfig(), 'cache-1', { fetchImpl, telemetry: new Telemetry(true, join(dir, 't.jsonl')), cache: new DecisionCache(true, 3600, dir) });
    const a = await rt.analyzeTask('Refactor the payment retry queue so failed charges back off exponentially.');
    const b = await rt.analyzeTask('Refactor the payment retry queue so failed charges back off exponentially.');
    assert.equal(a.meta.cached, false);
    assert.equal(b.meta.cached, true);
    assert.equal(fetchImpl.calls, 1);
    assert.equal(rt.stats().cachedCalls, 1);
});
test('session budget stops optional calls but not strict completion review', async () => {
    const rt = testRuntime('budget-1', {}, { sessionBudgetUsd: 0.00001 });
    await rt.analyzeTask('Add a health endpoint that returns build metadata.');
    await assert.rejects(rt.analyzeTask('Another task that should be blocked by the budget guard now.'), /budget/);
    assert.equal(rt.budgetExhausted(), true);
});
test('status reports configuration without secrets and checks connectivity', async () => {
    const rt = testRuntime('status-1');
    const report = await rt.status(true);
    assert.equal(report.api, 'connected');
    assert.equal(report.keyConfigured, true);
    assert.ok(!JSON.stringify(report).includes('sk-or-v1'));
    const offline = testRuntime('status-2', { failWith: [503, 503] });
    assert.equal((await offline.status(true)).api, 'error');
});
test('keyword extraction splits identifiers and drops stopwords', () => {
    const kws = extractKeywords('Fix the invoiceTotal rounding in billing/summary.ts and update the README');
    assert.ok(kws.includes('invoice') && kws.includes('total') && kws.includes('billing') && kws.includes('summary'));
    assert.ok(!kws.includes('the'));
});
test('candidate discovery is deterministic, excludes secrets and summarizes locally', () => {
    const repo = mkdtempSync(join(tmpdir(), 'jev-repo-'));
    mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
    writeFileSync(join(repo, 'src', 'billing', 'invoice.ts'), 'export function invoiceTotal(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}\n');
    writeFileSync(join(repo, 'src', 'unrelated.ts'), 'export const x = 1;\n');
    writeFileSync(join(repo, '.env'), 'INVOICE_SECRET=abc\n');
    const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git(['init', '-q']);
    git(['add', '-A']);
    const result = discoverCandidates('Fix invoice total rounding', repo, testConfig());
    assert.equal(result.gitAvailable, true);
    assert.deepEqual(result.candidates.map((c) => c.path), ['src/billing/invoice.ts']);
    assert.match(result.candidates[0]?.summary ?? '', /symbols: invoiceTotal/);
});
test('rankContext batches large candidate sets and never returns unknown paths', async () => {
    const fetchImpl = fakeFetch({ defaults: { score: 2.5 } });
    const dir = isolateDataDir();
    const rt = new Runtime(testConfig({ limits: { ...testConfig().limits, contextBatchSize: 5 } }), 'ctx-1', { fetchImpl, telemetry: new Telemetry(true, join(dir, 't.jsonl')), cache: new DecisionCache(false, 0, dir) });
    const candidates = Array.from({ length: 12 }, (_, i) => ({ path: `src/f${i}.ts`, summary: `file ${i}` }));
    const { ranked, calls } = await rt.rankContext('do the thing', candidates);
    assert.equal(calls, 3);
    assert.equal(ranked.length, 12);
    assert.ok(ranked.every((r) => r.band === 'full'));
    assert.ok(ranked.every((r) => candidates.some((c) => c.path === r.path)));
});
