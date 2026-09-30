import { credentialsFile, isOpenRouterKeyShape, readStoredKey, removeStoredKey, writeStoredKey } from './core/credentials.js';
import { loadConfig } from './core/config.js';
import { currentSessionId, Runtime } from './runtime/index.js';

export const CONFIGURE_HELP = `  configure                 save your OpenRouter key (masked prompt, verified, stored in ~/.jev-copilot)
  configure --status        where the key currently comes from
  configure --remove        delete the stored key
  configure --from-stdin    read the key from stdin (for scripts: printf '%s' "$KEY" | ... configure --from-stdin)`;

const GREEN = (s: string): string => (process.stdout.isTTY ? `\u001b[32m${s}\u001b[0m` : s);
const RED = (s: string): string => (process.stdout.isTTY ? `\u001b[31m${s}\u001b[0m` : s);
const DIM = (s: string): string => (process.stdout.isTTY ? `\u001b[2m${s}\u001b[0m` : s);

/** Reads one line from the terminal without echoing it. Falls back to plain reading when not a TTY. */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c: string) => (data += c));
      stdin.on('end', () => resolve(data));
      stdin.on('error', reject);
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };
    stdin.on('data', onData);
  });
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function verify(key: string): Promise<{ ok: boolean; detail?: string }> {
  const config = loadConfig({ ...process.env, OPENROUTER_API_KEY: key }, process.cwd());
  const runtime = new Runtime(config, currentSessionId());
  const report = await runtime.status(true);
  return report.api === 'connected' ? { ok: true } : { ok: false, ...(report.apiDetail ? { detail: report.apiDetail } : {}) };
}

export async function runConfigure(args: readonly string[], out: (line: string) => void = console.log): Promise<number> {
  const file = credentialsFile();
  if (args.includes('--status')) {
    const config = loadConfig(process.env, process.cwd());
    out(`Key source: ${config.keySource}`);
    out(`Credentials file: ${file}${readStoredKey() ? ' (present)' : ' (absent)'}`);
    out(DIM('Precedence: plugin config (/plugin → Configure) > OPENROUTER_API_KEY > credentials file.'));
    return 0;
  }
  if (args.includes('--remove')) {
    out(removeStoredKey() ? GREEN(`✔ Removed ${file}`) : `Nothing stored at ${file}`);
    return 0;
  }

  out('JEV Copilot · OpenRouter key setup');
  out(DIM('The key is typed here only; it is never shown, logged, or sent anywhere except openrouter.ai.'));
  const key = (args.includes('--from-stdin') ? await readAllStdin() : await promptSecret('Paste your OpenRouter API key (input hidden): ')).trim();
  if (!key) {
    out(RED('✖ No key entered. Nothing was saved.'));
    return 1;
  }
  if (!isOpenRouterKeyShape(key)) {
    out(RED('✖ That does not look like an OpenRouter key (expected sk-or-v1-…). Nothing was saved.'));
    return 1;
  }
  out(DIM('Verifying with a single tiny JEV call…'));
  const check = await verify(key);
  if (!check.ok) {
    out(RED(`✖ OpenRouter rejected the key or is unreachable${check.detail ? ` (${check.detail})` : ''}. Nothing was saved.`));
    return 2;
  }
  const saved = writeStoredKey(key);
  out(GREEN(`✔ Key verified and saved to ${saved}`));
  out(GREEN('✔ JEV Copilot is connected. New Claude Code sessions pick it up automatically; restart any running session.'));
  return 0;
}
