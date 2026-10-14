// server/src/tools/composio.js
// Bridge to Composio: gives the agent the ability to drive 500+ real apps
// (Gmail, Slack, GitHub, Notion, Google Sheets, Linear, ...) with one API key.
// Docs: https://docs.composio.dev
import { defineTool } from './registry.js';

const BASE = 'https://backend.composio.dev/api/v3';

async function composioFetch(fetchImpl, path, { apiKey, method = 'GET', body } = {}) {
  const res = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 2000) };
  }
  if (!res.ok) {
    throw new Error(`Composio ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return data;
}

export function createComposioTools({ composioApiKey = '', fetchImpl = globalThis.fetch } = {}) {
  const search = defineTool(
    'composio_search',
    'Discover Composio tools/actions for a given app or task (e.g. "send gmail email", "create github issue", "slack message"). Returns tool slugs you can run with composio_execute.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language description of the action you need.' },
        toolkit: { type: 'string', description: 'Optional app slug to filter, e.g. gmail, slack, github.' },
        limit: { type: 'number', description: 'Max tools to return (default 10).' },
      },
      required: ['query'],
    },
    async ({ query, toolkit, limit = 10 }, ctx = {}) => {
      const key = ctx.composioApiKey || composioApiKey;
      if (!key) throw new Error('composio_search requires a Composio API key (set it in Settings).');
      const params = new URLSearchParams({ query, limit: String(limit) });
      if (toolkit) params.set('toolkits', toolkit);
      const data = await composioFetch(fetchImpl, `/tools?${params.toString()}`, { apiKey: key });
      const items = data.items || data.tools || [];
      return {
        count: items.length,
        tools: items.slice(0, limit).map((t) => ({
          slug: t.slug || t.name,
          name: t.name,
          toolkit: t.toolkit?.slug || t.toolkit,
          description: (t.description || '').slice(0, 200),
        })),
      };
    },
    { category: 'apps' },
  );

  const execute = defineTool(
    'composio_execute',
    'Execute a Composio action on a connected app (use composio_search first to find the tool slug). This is how the agent uses apps like Gmail, Slack, GitHub, Notion, Sheets, etc.',
    {
      type: 'object',
      properties: {
        toolSlug: { type: 'string', description: 'Composio tool slug, e.g. GMAIL_SEND_EMAIL.' },
        arguments: { type: 'object', description: 'Arguments object for the tool (see composio_search).' },
        userId: { type: 'string', description: 'Composio connected-account user id (defaults to "default").' },
        connectedAccountId: { type: 'string', description: 'Optional specific connected account id.' },
      },
      required: ['toolSlug', 'arguments'],
    },
    async ({ toolSlug, arguments: args = {}, userId = 'default', connectedAccountId }, ctx = {}) => {
      const key = ctx.composioApiKey || composioApiKey;
      if (!key) throw new Error('composio_execute requires a Composio API key (set it in Settings).');
      const body = { arguments: args, user_id: userId };
      if (connectedAccountId) body.connected_account_id = connectedAccountId;
      const data = await composioFetch(fetchImpl, `/tools/execute/${encodeURIComponent(toolSlug)}`, {
        apiKey: key,
        method: 'POST',
        body,
      });
      return data;
    },
    { category: 'apps', dangerous: true },
  );

  return [search, execute];
}
