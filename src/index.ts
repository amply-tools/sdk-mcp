import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  makeLoginTool,
  makeLogoutTool,
  makeSignupTool,
  makeStatusTool,
  makeWhoamiTool,
} from './tools/auth.js';
import {
  makeCreateProjectTool,
  makeListProjectsTool,
} from './tools/projects.js';
import {
  makeCreateApplicationTool,
  makeGetApplicationTool,
  makeListApplicationsTool,
} from './tools/applications.js';
import { makeCreateApiKeyTool } from './tools/apiKeys.js';
import { makeBootstrapForAppTool } from './tools/bootstrap.js';
import { safeLog } from './tools/_helpers.js';

const PKG_VERSION = '0.1.0';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'amply-mcp',
    version: PKG_VERSION,
  });

  // The McpServer high-level API: `.tool(name, description, paramsSchema, handler)`.
  // We pass Zod object shapes; the SDK converts them to JSON Schema for clients.
  for (const def of allTools()) {
    const shape = (def.inputSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    server.tool(
      def.name,
      def.description,
      shape as never,
      // The SDK validates args against the schema before calling here.
      // The second arg (`extra`) carries request metadata; we don't use it.
      (async (args: Record<string, unknown>) => def.handler(args as never)) as never,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  safeLog(`amply-mcp ${PKG_VERSION} ready on stdio`);
}

function allTools() {
  return [
    makeStatusTool(),
    makeSignupTool(),
    makeLoginTool(),
    makeLogoutTool(),
    makeWhoamiTool(),
    makeListProjectsTool(),
    makeCreateProjectTool(),
    makeListApplicationsTool(),
    makeGetApplicationTool(),
    makeCreateApplicationTool(),
    makeCreateApiKeyTool(),
    makeBootstrapForAppTool(),
  ];
}

main().catch((err) => {
  process.stderr.write(`[amply-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
