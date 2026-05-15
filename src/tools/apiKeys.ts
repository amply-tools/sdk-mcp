import { z } from 'zod';
import { AmplyClient } from '../graphql/client.js';
import { API_KEY_CREATE } from '../graphql/mutations.js';
import { ok, safe, type CallToolResult } from './_helpers.js';

const createSchema = z.object({
  applicationId: z.string().uuid().describe('Application UUID — use amply_list_applications or amply_create_application to obtain.'),
});

interface ApiKeyCreateResponse {
  apiKeyCreate: {
    public: string;
    secret: string;
    lastUsed: string | null;
    application: { id: string; bundleId: string; name: string; platform: string };
  };
}

export function makeCreateApiKeyTool() {
  return {
    name: 'amply_create_api_key',
    description: 'Creates a new (additional) API key for an existing application. Returns `public` and `secret` in clear text — the secret will NOT be retrievable again later from the list endpoint, so the caller must save it immediately. Used to rotate or scope keys; for first-time setup use amply_create_application which already returns the first key.',
    inputSchema: createSchema,
    async handler(input: z.infer<typeof createSchema>): Promise<CallToolResult> {
      return safe(async () => {
        const client = new AmplyClient();
        const data = await client.request<ApiKeyCreateResponse>(API_KEY_CREATE, {
          application: input.applicationId,
        });
        return ok({ apiKey: data.apiKeyCreate });
      });
    },
  };
}
