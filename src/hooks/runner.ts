import { loadConfig } from '../core/config.js';
import { debugLog, describeError } from '../core/logger.js';
import { Runtime } from '../runtime/index.js';
import { onPostToolUse, onPreToolUse, onSessionEnd, onSessionStart, onStop, onUserPrompt } from './handlers.js';
import type { HookInput, HookResult } from './types.js';

/** Per-event wall-clock budget; well under the hooks.json timeouts so Claude never waits on us. */
const BUDGETS_MS: Record<string, number> = { SessionStart: 3000, UserPromptSubmit: 15000, PreToolUse: 10000, PostToolUse: 3000, Stop: 25000, SessionEnd: 1000 };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function dispatch(runtime: Runtime, input: HookInput): Promise<HookResult> {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return onSessionStart(runtime, input);
    case 'UserPromptSubmit':
      return onUserPrompt(runtime, input);
    case 'PreToolUse':
      return onPreToolUse(runtime, input);
    case 'PostToolUse':
      return onPostToolUse(runtime, input);
    case 'Stop':
      return onStop(runtime, input);
    case 'SessionEnd':
      return onSessionEnd(runtime, input);
    default:
      return undefined;
  }
}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(undefined); });
  });
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    input = parsed as HookInput;
  } catch {
    return;
  }
  const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
  try {
    const config = loadConfig(process.env, typeof input.cwd === 'string' ? input.cwd : process.cwd());
    const runtime = new Runtime(config, typeof input.session_id === 'string' ? input.session_id : 'local');
    const result = await withBudget(dispatch(runtime, input), BUDGETS_MS[event] ?? 5000);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch (error) {
    // Hooks fail open: never crash Claude Code, never print partial JSON.
    debugLog('hook:runner', `unhandled error in ${event}`, describeError(error));
  }
}

const invokedDirectly = process.argv[1] && /runner\.(?:js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  void main().finally(() => process.exit(0));
}
