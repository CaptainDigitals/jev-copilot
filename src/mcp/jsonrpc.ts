import { createInterface } from 'node:readline';

/**
 * Minimal MCP stdio server (newline-delimited JSON-RPC 2.0). Implements the subset
 * Claude Code needs for tool servers: initialize, ping, tools/list, tools/call.
 * Dependency-free so the plugin runs straight from the repository without npm install.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export class McpToolServer {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly info: { name: string; version: string }) {}

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  async handle(message: JsonRpcRequest): Promise<Record<string, unknown> | undefined> {
    const { id, method, params } = message;
    const isNotification = id === undefined;
    try {
      let result: unknown;
      switch (method) {
        case 'initialize': {
          const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
          result = { protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: this.info };
          break;
        }
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools: [...this.tools.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
          break;
        case 'tools/call': {
          const name = typeof params?.name === 'string' ? params.name : '';
          const tool = this.tools.get(name);
          if (!tool) return isNotification ? undefined : error(id, -32602, `Unknown tool: ${name}`);
          const args = params?.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
          try {
            const value = await tool.handler(args);
            result = { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError: false };
          } catch (err) {
            result = { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
          }
          break;
        }
        default:
          if (method.startsWith('notifications/')) return undefined;
          return isNotification ? undefined : error(id, -32601, `Method not found: ${method}`);
      }
      return isNotification ? undefined : { jsonrpc: '2.0', id, result };
    } catch (err) {
      return isNotification ? undefined : error(id, -32603, err instanceof Error ? err.message : 'internal error');
    }
  }

  /** Reads requests from stdin and writes responses to stdout until stdin closes. */
  serve(): void {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message: JsonRpcRequest;
      try {
        message = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        process.stdout.write(JSON.stringify(error(null, -32700, 'Parse error')) + '\n');
        return;
      }
      void this.handle(message).then((response) => {
        if (response) process.stdout.write(JSON.stringify(response) + '\n');
      });
    });
    rl.on('close', () => process.exit(0));
  }
}

function error(id: number | string | null | undefined, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}
