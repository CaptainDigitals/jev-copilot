import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathPolicy, classifyFileRole } from '../src/security/exclusions.js';
const policy = new PathPolicy(['.env', '.env.*', '**/*.pem', '**/.ssh/**', '**/credentials*', '**/secrets/**', '**/node_modules/**']);
test('default-denied paths are excluded at any depth', () => {
    for (const p of ['.env', 'apps/web/.env.local', 'certs/server.pem', 'C:\\Users\\me\\.ssh\\id_rsa', 'config/credentials.json', 'infra/secrets/prod.yaml', 'node_modules/left-pad/index.js']) {
        assert.equal(policy.isExcluded(p), true, `${p} should be excluded`);
    }
});
test('ordinary source paths are allowed', () => {
    for (const p of ['src/index.ts', 'README.md', 'src/env.ts', 'docs/environment.md', 'src/auth/session.ts']) {
        assert.equal(policy.isExcluded(p), false, `${p} should be allowed`);
    }
    assert.deepEqual(policy.filter(['src/a.ts', '.env']), ['src/a.ts']);
});
test('file roles are classified deterministically', () => {
    assert.deepEqual(classifyFileRole('src/auth/login.test.ts'), ['test', 'security']);
    assert.deepEqual(classifyFileRole('db/migrations/0002_add_users.sql'), ['migration']);
    assert.ok(classifyFileRole('.github/workflows/ci.yml').includes('config'));
    assert.deepEqual(classifyFileRole('src/components/Button.tsx'), ['source']);
});
