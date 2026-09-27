/**
 * Wire types for the OpenRouter Decisions API (TypeSafe JEV).
 * Verified against https://openrouter.ai/blog/insights/what-is-jev/ on 2026-09-26.
 */

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type QuestionBundle = Record<string, JevQuestion>;

export interface JevDecisionRequest {
  model: string;
  state: unknown;
  questions: QuestionBundle;
}

export interface NoulAnswer {
  type: 'noul';
  /** Probability that the answer is "yes", 0..1. */
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: 'score';
  /** Expected value over the ordered criteria, 0..(n-1). */
  score: number;
  legend?: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

export interface JevDecisionResponse {
  id?: string;
  model?: string;
  provider?: string;
  answers: Record<string, JevAnswer>;
  usage?: JevUsage;
}

export interface DecisionMeta {
  latencyMs: number;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  questionSet: string;
  questionSetVersion: string;
  responseId?: string;
}

export interface DecisionResult {
  answers: Record<string, JevAnswer>;
  meta: DecisionMeta;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'network' | 'timeout' | 'rate_limit' | 'http' | 'schema' | 'budget' | 'size',
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'JevError';
  }
}
