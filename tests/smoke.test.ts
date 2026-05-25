import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '..', 'dist', 'index.js');

/**
 * Minimal end-to-end smoke. Boots the MCP binary, performs the JSON-RPC
 * handshake, calls `tools/list`, then `amply_status`. Asserts:
 *  - server reports the right name/version
 *  - tools/list returns at least 12 tools
 *  - amply_status responds with `authenticated: false` when AMPLY_CREDS_FILE
 *    points at a non-existent file
 *
 * Does not exercise the network — for that, see PUBLISHING.md "Smoke procedure".
 */
test('mcp boots, advertises tools, amply_status works without creds', async () => {
  const child = spawn('node', [BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AMPLY_CREDS_FILE: '/tmp/amply-mcp-smoke-nonexistent.json',
    },
  });

  const responses: Record<string, unknown>[] = [];
  let buf = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        responses.push(JSON.parse(line));
      } catch {
        // Ignore non-JSON noise.
      }
    }
  });

  const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + '\n');

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'amply_status', arguments: {} },
  });

  await new Promise<void>((res) => setTimeout(res, 500));
  child.kill('SIGTERM');

  const initResp = responses.find((r) => (r as { id?: number }).id === 1);
  assert.ok(initResp, 'expected initialize response');
  assert.equal(
    (initResp as { result: { serverInfo: { name: string } } }).result.serverInfo.name,
    'amply-mcp',
  );

  const listResp = responses.find((r) => (r as { id?: number }).id === 2);
  assert.ok(listResp, 'expected tools/list response');
  const tools = (listResp as { result: { tools: Array<{ name: string }> } }).result.tools;
  assert.ok(tools.length >= 12, `expected ≥12 tools, got ${tools.length}`);
  const expectedTools = [
    'amply_status',
    'amply_signup',
    'amply_login',
    'amply_logout',
    'amply_whoami',
    'amply_list_projects',
    'amply_create_project',
    'amply_list_applications',
    'amply_get_application',
    'amply_create_application',
    'amply_create_api_key',
    'amply_bootstrap_for_app',
  ];
  for (const name of expectedTools) {
    assert.ok(tools.some((t) => t.name === name), `missing tool: ${name}`);
  }

  const statusResp = responses.find((r) => (r as { id?: number }).id === 3);
  assert.ok(statusResp, 'expected amply_status response');
  const text = (
    statusResp as {
      result: { content: Array<{ text: string }> };
    }
  ).result.content[0]!.text;
  const parsed = JSON.parse(text) as { authenticated: boolean; endpoint: string };
  assert.equal(parsed.authenticated, false);
  assert.ok(parsed.endpoint.includes('/mcp/'));
});
