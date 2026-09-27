import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeId, sessionsDir } from '../core/paths.js';
import type { TaskProfile, StrategyDecision } from '../policy/task-profile.js';
import type { Requirement } from './requirements.js';

export interface TestEvidence {
  command: string;
  outcome: 'pass' | 'fail' | 'unknown';
  at: string;
}

export interface ChangeSummary {
  created: string[];
  modified: string[];
  deleted: string[];
  testFiles: string[];
  migrationFiles: string[];
  configFiles: string[];
  securityFiles: string[];
}

export interface SessionState {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  /** Redacted, truncated copy of the last analyzed prompt; used to build review state. */
  request?: string;
  profile?: TaskProfile;
  strategy?: StrategyDecision;
  requirements: Requirement[];
  changes: ChangeSummary;
  tests: TestEvidence[];
  /** Change count when the last completion review ran; prevents duplicate reviews. */
  reviewedAtChangeCount: number;
  changeCount: number;
  repairCount: number;
  lastReviewDecision?: 'pass' | 'repair' | 'manual-review';
}

export function emptyChanges(): ChangeSummary {
  return { created: [], modified: [], deleted: [], testFiles: [], migrationFiles: [], configFiles: [], securityFiles: [] };
}

export function newSession(sessionId: string): SessionState {
  const now = new Date().toISOString();
  return { sessionId, startedAt: now, updatedAt: now, requirements: [], changes: emptyChanges(), tests: [], reviewedAtChangeCount: 0, changeCount: 0, repairCount: 0 };
}

function fileFor(sessionId: string): string {
  return join(sessionsDir(), `${safeId(sessionId)}.json`);
}

export function loadSession(sessionId: string): SessionState {
  const file = fileFor(sessionId);
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SessionState>;
      return { ...newSession(sessionId), ...parsed, changes: { ...emptyChanges(), ...(parsed.changes ?? {}) } };
    }
  } catch {
    // Corrupt state is replaced rather than crashing a hook.
  }
  return newSession(sessionId);
}

export function saveSession(state: SessionState): SessionState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  try {
    writeFileSync(fileFor(state.sessionId), JSON.stringify(next), 'utf8');
  } catch {
    // Persisting state is best-effort; hooks continue with in-memory state.
  }
  return next;
}

function addUnique(list: readonly string[], item: string): string[] {
  return list.includes(item) ? [...list] : [...list, item];
}

/** Returns a new state with a file change recorded (PRD FR-010). */
export function recordFileChange(state: SessionState, path: string, kind: 'created' | 'modified' | 'deleted', roles: readonly string[]): SessionState {
  const changes: ChangeSummary = { ...state.changes };
  if (kind === 'created') changes.created = addUnique(changes.created, path);
  else if (kind === 'deleted') changes.deleted = addUnique(changes.deleted, path);
  else if (!changes.created.includes(path)) changes.modified = addUnique(changes.modified, path);
  if (roles.includes('test')) changes.testFiles = addUnique(changes.testFiles, path);
  if (roles.includes('migration')) changes.migrationFiles = addUnique(changes.migrationFiles, path);
  if (roles.includes('config')) changes.configFiles = addUnique(changes.configFiles, path);
  if (roles.includes('security')) changes.securityFiles = addUnique(changes.securityFiles, path);
  return { ...state, changes, changeCount: state.changeCount + 1 };
}

export function recordTestEvidence(state: SessionState, evidence: TestEvidence): SessionState {
  const tests = [...state.tests.filter((t) => t.command !== evidence.command), evidence].slice(-20);
  return { ...state, tests };
}

/** Starts a fresh task within the same session, keeping the session id. */
export function resetForNewTask(state: SessionState, request: string): SessionState {
  return { ...newSession(state.sessionId), startedAt: state.startedAt, request };
}

export function totalChangedFiles(state: SessionState): number {
  return state.changes.created.length + state.changes.modified.length + state.changes.deleted.length;
}
