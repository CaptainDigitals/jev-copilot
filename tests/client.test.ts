import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JevClient } from '../src/jev/client.js';
import { JevError, type JevDecisionRequest } from '../src/jev/types.js';
import { fakeFetch, FAKE_KEY } from './helpers.js';

const request: JevDecisionRequest = { model: 'typesafe/jev-1.13', state: { userRequest: 'hello' }, questions: { ok: { type: 'noul', instructions: 'x' } } };
const base = { apiKey: FAKE_KEY, endpoint: 'https://openrouter.ai/api/alpha/decisions', timeoutMs: 200, maxRetries: 1, retryBaseDelayMs: 1, maxStateChars: 60000, sleep: async () => {} };

test('successful decision returns validated answers and usage', async () => {
  const fetchImpl = fakeFetch({ overrides: { ok: 0.93 } });
  const client = new JevClient({ ...base, fetchImpl });
  const r = await client.decide(request);
  assert.equal(r.answers.ok?.type, 'noul');
  assert.equal(r.usage?.input_tokens, 300);
  assert.equal(fetchImpl.calls, 1);
});

test('sends bearer auth and required headers', async () => {
  let headers: Record<string, string> = {};
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    headers = init?.headers as Record<string, string>;
    return fakeFetch()(_u, init);
  }) as typeof fetch;
  await new JevClient({ ...base, fetchImpl }).decide(request);
  assert.equal(headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('retries once on 429/5xx then succeeds', async () => {
  const fetchImpl = fakeFetch({ failWith: [429] });
  const r = await new JevClient({ ...base, fetchImpl }).decide(request);
  assert.ok(r.answers.ok);
  assert.equal(fetchImpl.calls, 2);
  const twice = fakeFetch({ failWith: [500, 500] });
  await assert.rejects(new JevClient({ ...base, fetchImpl: twice }).decide(request), (e: unknown) => e instanceof JevError && e.kind === 'http' && e.status === 500);
  assert.equal(twice.calls, 2);
});

test('does not retry client errors and redacts keys from error text', async () => {
  const fetchImpl = (async () => new Response(`bad request for ${FAKE_KEY}`, { status: 400 })) as typeof fetch;
  await assert.rejects(new JevClient({ ...base, fetchImpl }).decide(request), (e: unknown) => e instanceof JevError && e.kind === 'http' && !e.message.includes(FAKE_KEY) && e.message.includes('[REDACTED_OPENROUTER_KEY]'));
});

test('times out and reports a timeout error', async () => {
  const fetchImpl = fakeFetch({ hang: true });
  await assert.rejects(new JevClient({ ...base, fetchImpl, maxRetries: 0 }).decide(request), (e: unknown) => e instanceof JevError && e.kind === 'timeout');
});

test('malformed responses fail schema validation', async () => {
  await assert.rejects(new JevClient({ ...base, fetchImpl: fakeFetch({ malformed: true }) }).decide(request), (e: unknown) => e instanceof JevError && e.kind === 'schema');
});

test('refuses non-https or unknown hosts, missing keys and oversized state', async () => {
  assert.throws(() => new JevClient({ ...base, endpoint: 'http://openrouter.ai/api/alpha/decisions' }), /https/);
  assert.throws(() => new JevClient({ ...base, endpoint: 'https://evil.example/decisions' }), /not allowed/);
  await assert.rejects(new JevClient({ ...base, apiKey: '' }).decide(request), (e: unknown) => e instanceof JevError && e.kind === 'config');
  await assert.rejects(new JevClient({ ...base, maxStateChars: 10 }).decide(request), (e: unknown) => e instanceof JevError && e.kind === 'size');
});
