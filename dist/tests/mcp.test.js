import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/mcp/server.js';
import { testRuntime } from './helpers.js';
test('MCP server handles the initialize/tools handshake and tool calls', async () => {
    const server = createServer(testRuntime('mcp-1', { overrides: { task_type: 'bug_fix', complexity: 0.6 } }));
    const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal((init?.result).protocolVersion, '2025-06-18');
    assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
    const list = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = ((list?.result).tools).map((t) => t.name);
    assert.deepEqual(names, ['jev_status', 'jev_analyze_task', 'jev_rank_context', 'jev_context', 'jev_review_completion', 'jev_assess_tool_action', 'jev_session_stats']);
    const call = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'jev_analyze_task', arguments: { request: 'Fix the off-by-one error in pagination when the page size divides the total exactly.' } } });
    const payload = JSON.parse((call?.result).content[0]?.text ?? '{}');
    assert.equal(payload.profile.taskType, 'bug_fix');
    const bad = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'jev_rank_context', arguments: { task: 'x', candidates: [] } } });
    assert.equal((bad?.result).isError, true);
    const unknown = await server.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
    assert.equal((unknown?.error).code, -32601);
});
test('jev_assess_tool_action and jev_session_stats work without network', async () => {
    const server = createServer(testRuntime('mcp-2'));
    const assess = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jev_assess_tool_action', arguments: { toolName: 'Bash', toolInput: { command: 'rm -rf /' } } } });
    const decision = JSON.parse((assess?.result).content[0]?.text ?? '{}');
    assert.equal(decision.deterministic.hardDeny, true);
    assert.equal(decision.action, 'ask');
    const stats = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'jev_session_stats', arguments: {} } });
    assert.match((stats?.result).content[0]?.text ?? '', /"calls": 0/);
});
