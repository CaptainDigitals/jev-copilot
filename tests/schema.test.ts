import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDecisionResponse, noul, choice, score } from '../src/jev/schema.js';
import { JevError, type QuestionBundle } from '../src/jev/types.js';

const questions: QuestionBundle = {
  team: { type: 'choice', instructions: 'x', criteria: { billing: 'a', technical: 'b' } },
  urgency: { type: 'score', instructions: 'x', criteria: ['low', 'mid', 'high'] },
  refund: { type: 'noul', instructions: 'x' },
};

const wire = {
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    team: { type: 'choice', choice: 'billing', probabilities: { technical: 0, billing: 1 }, confidence: 1 },
    urgency: { type: 'score', score: 2, legend: { '0': 'low', '1': 'mid', '2': 'high' }, probabilities: { '0': 0, '1': 0, '2': 1 }, confidence: 1 },
    refund: { type: 'noul', noul: 0.82 },
    extra: { type: 'noul', noul: 0.1 },
  },
  usage: { input_tokens: 447, output_tokens: 69, cost: 0.000018774 },
  id: 'gen-dec-1',
};

test('parses the documented OpenRouter wire format and drops unknown answers', () => {
  const r = validateDecisionResponse(wire, questions);
  assert.equal(choice(r.answers, 'team')?.choice, 'billing');
  assert.equal(score(r.answers, 'urgency')?.score, 2);
  assert.equal(noul(r.answers, 'refund'), 0.82);
  assert.equal(r.answers.extra, undefined);
  assert.equal(r.usage?.cost, 0.000018774);
  assert.equal(r.model, 'typesafe/jev-1.13-20260917');
});

test('rejects missing answers, type mismatches and undeclared choices', () => {
  assert.throws(() => validateDecisionResponse({ answers: { team: wire.answers.team } }, questions), (e: unknown) => e instanceof JevError && e.kind === 'schema');
  const wrongType = { answers: { ...wire.answers, refund: { type: 'score', score: 1, probabilities: {} } } };
  assert.throws(() => validateDecisionResponse(wrongType, questions), /expected noul/);
  const badChoice = { answers: { ...wire.answers, team: { ...wire.answers.team, choice: 'legal' } } };
  assert.throws(() => validateDecisionResponse(badChoice, questions), /not a declared option/);
  assert.throws(() => validateDecisionResponse('nope', questions), /no answers/);
});

test('clamps out-of-range numbers instead of inferring values', () => {
  const r = validateDecisionResponse({ answers: { ...wire.answers, refund: { type: 'noul', noul: 1.7 }, urgency: { ...wire.answers.urgency, score: 9 } } }, questions);
  assert.equal(noul(r.answers, 'refund'), 1);
  assert.equal(score(r.answers, 'urgency')?.score, 2);
});
