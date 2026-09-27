import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactTextDetailed, redactValue, looksBinary } from '../src/security/redact.js';

/**
 * Synthetic secrets are assembled from fragments at runtime so that no
 * provider-shaped token ever exists on disk (GitHub push protection would,
 * correctly, refuse to accept a file containing them).
 */
const j = (...parts: string[]): string => parts.join('');
const OPENROUTER = j('sk-or-', 'v1-', 'abcdef0123456789'.repeat(4));
const AWS = j('AKIA', 'IOSFODNN7', 'EXAMPLE');
const GITHUB = j('gh', 'p_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123');
const SLACK = j('xox', 'b-', '1234567890-ABCDEFGHIJKLMNOPQRSTUVWX');
const STRIPE = j('sk_', 'live_', 'ABCDEFGHIJKLMNOPQRSTUVWX');
const JWT = j('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
const PEM_BODY = 'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHl6z4gG2KcLVGcsvVpb';
const PEM = j('-----BEGIN RSA ', 'PRIVATE KEY-----\n', PEM_BODY, '\n-----END RSA ', 'PRIVATE KEY-----');

const fixture = [
  '# Synthetic secrets fixture. None of these values are real credentials.',
  `OPENROUTER_API_KEY=${OPENROUTER}`,
  `AWS_ACCESS_KEY_ID=${AWS}`,
  'DB_PASSWORD=hunter2secret',
  'DATABASE_URL=postgres://app:hunter2secret@db.internal:5432/app',
  `GITHUB_TOKEN=${GITHUB}`,
  `SLACK_BOT_TOKEN=${SLACK}`,
  `STRIPE_KEY=${STRIPE}`,
  `jwt = ${JWT}`,
  'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
  PEM,
].join('\n');

test('fixture secrets are all masked before egress', () => {
  const { text, redactions } = redactTextDetailed(fixture);
  assert.ok(redactions >= 8, `expected many redactions, got ${redactions}`);
  for (const needle of [OPENROUTER, AWS, 'hunter2secret', PEM_BODY, GITHUB, JWT.slice(0, 60), SLACK, STRIPE, 'BEGIN RSA']) {
    assert.ok(!text.includes(needle), `leaked: ${needle.slice(0, 12)}...`);
  }
  assert.ok(text.includes('[REDACTED_OPENROUTER_KEY]'));
  assert.ok(text.includes('[REDACTED_PRIVATE_KEY]'));
  assert.ok(text.includes('postgres://app:[REDACTED_PASSWORD]@db.internal:5432/app'));
});

test('ordinary code, hashes and paths survive redaction', () => {
  const code = 'const sha = "3b18e512dba79e4c8300dd08aeb37f8e728b8dad"; import x from "./src/components/hero/HeroVisual.tsx"; DATABASE_URL_PLACEHOLDER=none';
  assert.equal(redactText(code), code);
});

test('redactValue walks nested objects and returns a new value', () => {
  const input = { a: ['token: Bearer abcdefghijklmnopqrstuvwxyz0123'], b: { key: OPENROUTER } };
  const out = redactValue(input);
  assert.notEqual(out, input);
  assert.equal(out.b.key, '[REDACTED_OPENROUTER_KEY]');
  assert.ok(out.a[0]?.includes('[REDACTED_TOKEN]'));
  assert.equal(input.b.key, OPENROUTER);
});

test('binary detection', () => {
  assert.equal(looksBinary('plain text\nwith lines'), false);
  assert.equal(looksBinary('PNG\u0000\u0001\u0002binary'), true);
});
