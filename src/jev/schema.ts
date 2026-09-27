import { isRecord } from '../core/config.js';
import { JevError, type ChoiceAnswer, type JevAnswer, type JevDecisionResponse, type JevUsage, type NoulAnswer, type QuestionBundle, type ScoreAnswer } from './types.js';

function unit(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new JevError(`answer field ${field} is not a number`, 'schema');
  return Math.min(1, Math.max(0, value));
}

function probabilities(value: unknown, field: string): Record<string, number> {
  if (!isRecord(value)) throw new JevError(`answer field ${field}.probabilities missing`, 'schema');
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) out[k] = unit(v, `${field}.probabilities.${k}`);
  return out;
}

function parseNoul(id: string, raw: Record<string, unknown>): NoulAnswer {
  return { type: 'noul', noul: unit(raw.noul, `${id}.noul`) };
}

function parseChoice(id: string, raw: Record<string, unknown>, allowed: readonly string[]): ChoiceAnswer {
  if (typeof raw.choice !== 'string') throw new JevError(`answer ${id}.choice missing`, 'schema');
  if (allowed.length && !allowed.includes(raw.choice)) throw new JevError(`answer ${id}.choice "${raw.choice}" is not a declared option`, 'schema');
  const probs = probabilities(raw.probabilities, id);
  const confidence = typeof raw.confidence === 'number' ? unit(raw.confidence, `${id}.confidence`) : (probs[raw.choice] ?? 0);
  return { type: 'choice', choice: raw.choice, probabilities: probs, confidence };
}

function parseScore(id: string, raw: Record<string, unknown>, levels: number): ScoreAnswer {
  if (typeof raw.score !== 'number' || !Number.isFinite(raw.score)) throw new JevError(`answer ${id}.score missing`, 'schema');
  const max = Math.max(0, levels - 1);
  const score = Math.min(max, Math.max(0, raw.score));
  const probs = probabilities(raw.probabilities, id);
  const top = Math.max(0, ...Object.values(probs));
  const confidence = typeof raw.confidence === 'number' ? unit(raw.confidence, `${id}.confidence`) : top;
  const legend = isRecord(raw.legend) ? (Object.fromEntries(Object.entries(raw.legend).map(([k, v]) => [k, String(v)])) as Record<string, string>) : undefined;
  return legend ? { type: 'score', score, legend, probabilities: probs, confidence } : { type: 'score', score, probabilities: probs, confidence };
}

function parseUsage(raw: unknown): JevUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const usage: JevUsage = {};
  if (typeof raw.input_tokens === 'number') usage.input_tokens = raw.input_tokens;
  if (typeof raw.output_tokens === 'number') usage.output_tokens = raw.output_tokens;
  if (typeof raw.cost === 'number') usage.cost = raw.cost;
  return usage;
}

/**
 * Validates a Decisions API body against the questions that were asked.
 * Every asked question must be answered with the declared type; extra answers are dropped.
 * Missing values are never inferred (PRD §19).
 */
export function validateDecisionResponse(raw: unknown, questions: QuestionBundle): JevDecisionResponse {
  if (!isRecord(raw) || !isRecord(raw.answers)) throw new JevError('Decisions API response has no answers object', 'schema');
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const entry = raw.answers[id];
    if (!isRecord(entry)) throw new JevError(`answer ${id} missing from response`, 'schema');
    if (typeof entry.type === 'string' && entry.type !== question.type) {
      throw new JevError(`answer ${id} has type ${entry.type}, expected ${question.type}`, 'schema');
    }
    if (question.type === 'noul') answers[id] = parseNoul(id, entry);
    else if (question.type === 'choice') answers[id] = parseChoice(id, entry, Object.keys(question.criteria));
    else answers[id] = parseScore(id, entry, question.criteria.length);
  }
  const response: JevDecisionResponse = { answers };
  if (typeof raw.id === 'string') response.id = raw.id;
  if (typeof raw.model === 'string') response.model = raw.model;
  if (typeof raw.provider === 'string') response.provider = raw.provider;
  const usage = parseUsage(raw.usage);
  if (usage) response.usage = usage;
  return response;
}

/* Typed accessors used by policy code. They return undefined rather than guessing. */

export function noul(answers: Record<string, JevAnswer>, id: string): number | undefined {
  const a = answers[id];
  return a?.type === 'noul' ? a.noul : undefined;
}

export function choice(answers: Record<string, JevAnswer>, id: string): ChoiceAnswer | undefined {
  const a = answers[id];
  return a?.type === 'choice' ? a : undefined;
}

export function score(answers: Record<string, JevAnswer>, id: string): ScoreAnswer | undefined {
  const a = answers[id];
  return a?.type === 'score' ? a : undefined;
}
