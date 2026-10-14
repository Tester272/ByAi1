// server/src/tools/index.js
// Assembles the default toolset the agent can use.
import { ToolRegistry, defineTool } from './registry.js';
import { createWebTools } from './web.js';
import { createMemoryTools } from './memory.js';
import { createTaskTools } from './tasks.js';
import { createComposioTools } from './composio.js';

const clockTool = defineTool(
  'current_time',
  'Get the current date and time (UTC and local ISO strings, plus epoch ms).',
  { type: 'object', properties: {} },
  async () => ({
    utc: new Date().toISOString(),
    epochMs: Date.now(),
  }),
  { category: 'util' },
);

export function buildDefaultTools(config = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  return [
    ...createWebTools({ fetchImpl, tavilyApiKey: config.tavilyApiKey }),
    ...createMemoryTools(),
    ...createTaskTools(),
    ...createComposioTools({ composioApiKey: config.composioApiKey, fetchImpl }),
    clockTool,
  ];
}

export function createRegistry(config = {}, deps = {}) {
  return new ToolRegistry(buildDefaultTools(config, deps));
}

export { ToolRegistry, defineTool };
