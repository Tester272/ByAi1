// server/src/tools/memory.js
// Long-term memory so the agent remembers facts across chats and long tasks.
import { defineTool } from './registry.js';

export function createMemoryTools() {
  const save = defineTool(
    'memory_save',
    'Persist a durable fact, preference or note to long-term memory so it can be recalled in future sessions.',
    {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or note to remember.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
      },
      required: ['content'],
    },
    async ({ content, tags = [] }, ctx = {}) => {
      if (!ctx.store) throw new Error('memory tool requires a store in context');
      const mem = ctx.store.addMemory({ userId: ctx.userId || 'local', content, tags });
      return { saved: true, id: mem.id };
    },
    { category: 'memory' },
  );

  const recall = defineTool(
    'memory_recall',
    'Search long-term memory for previously saved facts relevant to a query.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for. Empty returns the most recent memories.' },
        limit: { type: 'number', description: 'Max results (default 10).' },
      },
    },
    async ({ query = '', limit = 10 }, ctx = {}) => {
      if (!ctx.store) throw new Error('memory tool requires a store in context');
      const userId = ctx.userId || 'local';
      const items = query
        ? ctx.store.searchMemories(userId, query, limit)
        : ctx.store.listMemories(userId, limit);
      return { count: items.length, memories: items.map((m) => ({ content: m.content, tags: m.tags })) };
    },
    { category: 'memory' },
  );

  return [save, recall];
}
