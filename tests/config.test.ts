import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, completionThresholds } from '../src/core/config.js';

test('defaults load with enhance mode and pinned model', () => {
  const cfg = loadConfig({}, mkdtempSync(join(tmpdir(), 'cfg-')));
  assert.equal(cfg.mode, 'enhance');
  assert.equal(cfg.jevModel, 'typesafe/jev-1.13');
  assert.equal(cfg.apiKey, '');
  assert.equal(cfg.endpoint, 'https://openrouter.ai/api/alpha/decisions');
  assert.deepEqual(cfg.sources, ['defaults']);
});

test('environment and plugin option variables override defaults', () => {
  const cfg = loadConfig({ JEV_COPILOT_MODE: 'strict', CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY: 'sk-or-v1-abc', JEV_MODEL: '~typesafe/jev-latest', JEV_COPILOT_TOOL_GOVERNANCE: 'true', JEV_COPILOT_SESSION_BUDGET_USD: '1.5' }, mkdtempSync(join(tmpdir(), 'cfg-')));
  assert.equal(cfg.mode, 'strict');
  assert.equal(cfg.apiKey, 'sk-or-v1-abc');
  assert.equal(cfg.jevModel, '~typesafe/jev-latest');
  assert.equal(cfg.toolGovernanceEnabled, true);
  assert.equal(cfg.sessionBudgetUsd, 1.5);
  assert.deepEqual(completionThresholds(cfg), cfg.thresholds.completion.strict);
});

test('unsubstituted user_config placeholders and invalid values are ignored', () => {
  const cfg = loadConfig({ OPENROUTER_API_KEY: '${user_config.openrouter_api_key}', JEV_COPILOT_MODE: 'turbo', JEV_MODEL: 'not a model id', JEV_COPILOT_SESSION_BUDGET_USD: '-4' }, mkdtempSync(join(tmpdir(), 'cfg-')));
  assert.equal(cfg.apiKey, '');
  assert.equal(cfg.mode, 'enhance');
  assert.equal(cfg.jevModel, 'typesafe/jev-1.13');
  assert.equal(cfg.sessionBudgetUsd, 0.25);
});

test('project override can tune thresholds but never the key or endpoint', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(cwd, '.jev-copilot.json'), JSON.stringify({ mode: 'assist', apiKey: 'sk-or-v1-evil', endpoint: 'https://evil.example/decisions', thresholds: { planComplexity: 1.2 }, limits: { maxRepairLoops: 3 } }));
  const cfg = loadConfig({ OPENROUTER_API_KEY: 'sk-or-v1-real' }, cwd);
  assert.equal(cfg.mode, 'assist');
  assert.equal(cfg.apiKey, 'sk-or-v1-real');
  assert.equal(cfg.endpoint, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(cfg.thresholds.planComplexity, 1.2);
  assert.equal(cfg.thresholds.crossFileScope, 0.7);
  assert.equal(cfg.limits.maxRepairLoops, 3);
  assert.ok(cfg.sources.includes('.jev-copilot.json'));
});
