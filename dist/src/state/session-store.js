import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeId, sessionsDir } from '../core/paths.js';
export function emptyChanges() {
    return { created: [], modified: [], deleted: [], testFiles: [], migrationFiles: [], configFiles: [], securityFiles: [] };
}
export function newSession(sessionId) {
    const now = new Date().toISOString();
    return { sessionId, startedAt: now, updatedAt: now, requirements: [], changes: emptyChanges(), tests: [], reviewedAtChangeCount: 0, changeCount: 0, repairCount: 0 };
}
function fileFor(sessionId) {
    return join(sessionsDir(), `${safeId(sessionId)}.json`);
}
export function loadSession(sessionId) {
    const file = fileFor(sessionId);
    try {
        if (existsSync(file)) {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            return { ...newSession(sessionId), ...parsed, changes: { ...emptyChanges(), ...(parsed.changes ?? {}) } };
        }
    }
    catch {
        // Corrupt state is replaced rather than crashing a hook.
    }
    return newSession(sessionId);
}
export function saveSession(state) {
    const next = { ...state, updatedAt: new Date().toISOString() };
    try {
        writeFileSync(fileFor(state.sessionId), JSON.stringify(next), 'utf8');
    }
    catch {
        // Persisting state is best-effort; hooks continue with in-memory state.
    }
    return next;
}
function addUnique(list, item) {
    return list.includes(item) ? [...list] : [...list, item];
}
/** Returns a new state with a file change recorded (PRD FR-010). */
export function recordFileChange(state, path, kind, roles) {
    const changes = { ...state.changes };
    if (kind === 'created')
        changes.created = addUnique(changes.created, path);
    else if (kind === 'deleted')
        changes.deleted = addUnique(changes.deleted, path);
    else if (!changes.created.includes(path))
        changes.modified = addUnique(changes.modified, path);
    if (roles.includes('test'))
        changes.testFiles = addUnique(changes.testFiles, path);
    if (roles.includes('migration'))
        changes.migrationFiles = addUnique(changes.migrationFiles, path);
    if (roles.includes('config'))
        changes.configFiles = addUnique(changes.configFiles, path);
    if (roles.includes('security'))
        changes.securityFiles = addUnique(changes.securityFiles, path);
    return { ...state, changes, changeCount: state.changeCount + 1 };
}
export function recordTestEvidence(state, evidence) {
    const tests = [...state.tests.filter((t) => t.command !== evidence.command), evidence].slice(-20);
    return { ...state, tests };
}
/** Starts a fresh task within the same session, keeping the session id. */
export function resetForNewTask(state, request) {
    return { ...newSession(state.sessionId), startedAt: state.startedAt, request };
}
export function totalChangedFiles(state) {
    return state.changes.created.length + state.changes.modified.length + state.changes.deleted.length;
}
