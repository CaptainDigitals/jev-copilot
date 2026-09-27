import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { buildRequirementContract } from '../src/state/requirements.js';
import { loadSession, newSession, recordFileChange, recordTestEvidence, resetForNewTask, saveSession, totalChangedFiles } from '../src/state/session-store.js';
import { Telemetry } from '../src/state/telemetry.js';
import { DecisionCache } from '../src/jev/cache.js';
import { isolateDataDir } from './helpers.js';

const thresholds = { testsRequired: 0.7, securitySensitive: 0.6 };

test('requirement contract keeps explicit items verbatim and labels inferred ones', () => {
  const prompt = 'Add OAuth login with Google.\n- Persist the session in Redis\n- Never log access tokens\nAlso update the README.';
  const profile = { taskType: 'feature', taskTypeConfidence: 0.9, complexity: 2, complexityConfidence: 0.9, requiresRepoExploration: 0.9, crossFileScope: 0.9, testsRequired: 0.95, securitySensitive: 0.9, dataChangeSensitive: 0.1, requirementsAmbiguous: 0.2 };
  const reqs = buildRequirementContract(prompt, profile, thresholds);
  const explicit = reqs.filter((r) => r.source === 'explicit');
  assert.equal(explicit.length, 4);
  assert.equal(explicit[0]?.text, 'Add OAuth login with Google.');
  assert.equal(explicit.find((r) => r.text.startsWith('Never log'))?.severity, 'high');
  assert.equal(explicit.find((r) => /README/.test(r.text))?.verification, 'docs');
  assert.deepEqual(reqs.filter((r) => r.source === 'inferred').map((r) => r.id), ['INF-TEST', 'INF-SEC']);
});

test('a prompt without imperative sentences still yields one explicit requirement', () => {
  const reqs = buildRequirementContract('The invoice totals look wrong for EU customers since yesterday.', undefined, thresholds);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0]?.source, 'explicit');
});

test('session store records changes immutably and persists', () => {
  isolateDataDir();
  const s0 = newSession('sess-1');
  const s1 = recordFileChange(s0, 'src/a.ts', 'created', ['source']);
  const s2 = recordFileChange(s1, 'src/a.ts', 'modified', ['source']);
  const s3 = recordFileChange(s2, 'tests/a.test.ts', 'modified', ['test']);
  assert.equal(s0.changeCount, 0);
  assert.deepEqual(s3.changes.created, ['src/a.ts']);
  assert.deepEqual(s3.changes.modified, ['tests/a.test.ts']);
  assert.deepEqual(s3.changes.testFiles, ['tests/a.test.ts']);
  assert.equal(totalChangedFiles(s3), 2);
  const s4 = recordTestEvidence(s3, { command: 'npm test', outcome: 'pass', at: 'now' });
  saveSession(s4);
  const loaded = loadSession('sess-1');
  assert.equal(loaded.tests[0]?.outcome, 'pass');
  assert.equal(totalChangedFiles(loaded), 2);
  const reset = resetForNewTask(loaded, 'new task');
  assert.equal(totalChangedFiles(reset), 0);
  assert.equal(reset.request, 'new task');
  assert.equal(reset.sessionId, 'sess-1');
});

test('telemetry aggregates metadata only', () => {
  const dir = isolateDataDir();
  const t = new Telemetry(true, join(dir, 't.jsonl'));
  t.recordDecision('s', { latencyMs: 80, cached: false, inputTokens: 300, outputTokens: 10, costUsd: 0.00001, model: 'm', questionSet: 'task-analysis', questionSetVersion: '1.0.0' }, 'abc');
  t.recordDecision('s', { latencyMs: 0, cached: true, inputTokens: 0, outputTokens: 0, costUsd: 0, model: 'm', questionSet: 'task-analysis', questionSetVersion: '1.0.0' }, 'abc');
  t.record({ sessionId: 's', kind: 'repair' });
  t.record({ sessionId: 'other', kind: 'failure', error: 'x' });
  const stats = t.stats('s', 'enhance', 'm');
  assert.equal(stats.calls, 2);
  assert.equal(stats.cachedCalls, 1);
  assert.equal(stats.avgLatencyMs, 80);
  assert.equal(stats.completionRepairs, 1);
  assert.equal(stats.failures, 0);
  assert.equal(stats.estimatedCostUsd, 0.00001);
});

test('decision cache respects ttl and key composition', () => {
  const dir = isolateDataDir();
  const cache = new DecisionCache(true, 1, dir);
  const questions = { q: { type: 'noul' as const, instructions: 'x' } };
  const k1 = cache.key({ model: 'm', state: { a: 1 }, questions, questionSetVersion: '1', policyVersion: '1' });
  const k2 = cache.key({ model: 'm', state: { a: 1 }, questions, questionSetVersion: '2', policyVersion: '1' });
  assert.notEqual(k1, k2);
  cache.set(k1, { answers: { q: { type: 'noul', noul: 0.5 } }, inputTokens: 1, outputTokens: 0, costUsd: 0 });
  assert.equal(cache.get(k1)?.answers.q?.type, 'noul');
  const expired = new DecisionCache(true, -1, dir);
  assert.equal(expired.get(k1), undefined);
});
