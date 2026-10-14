// server/src/app.js
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROVIDERS, defaultModel } from './llm/provider.js';
import { createLLMResolver } from './llm/resolve.js';
import { createRegistry } from './tools/index.js';
import { runAgentLoop } from './agent/loop.js';
import { buildSystemPrompt } from './agent/prompts.js';
import { log } from './util/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

function sseInit(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createApp({ store, config, worker, registry, fetchImpl = globalThis.fetch }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  const tools = registry || createRegistry(config, { fetchImpl });

  // Resolve the LLM to use: request body > saved settings > server env.
  const resolveLLM = createLLMResolver({ store, config, fetchImpl });

  function toolContext(body = {}) {
    const saved = store.getSetting('keys', {}) || {};
    return {
      store,
      userId: body.userId || 'local',
      fetchImpl,
      composioApiKey: body.composioApiKey || saved.composioApiKey || config.composioApiKey,
      tavilyApiKey: body.tavilyApiKey || saved.tavilyApiKey || config.tavilyApiKey,
      onTaskCreated: (task) => log.info(`agent created long task ${task.id}`),
    };
  }

  // ---- health & metadata -----------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, providers: PROVIDERS, tools: tools.names(), tasks: store.listTasks('local', 1).length });
  });

  app.get('/api/tools', (_req, res) => res.json({ tools: tools.describe() }));

  app.get('/api/config', (_req, res) => {
    const llm = store.getSetting('llm', {}) || {};
    const keys = store.getSetting('keys', {}) || {};
    res.json({
      providers: PROVIDERS,
      defaultModel: defaultModel(llm.provider || config.defaultLlm.provider || 'openai'),
      hasLlmKey: !!(llm.apiKey || config.defaultLlm.apiKey),
      hasComposioKey: !!(keys.composioApiKey || config.composioApiKey),
      hasTavilyKey: !!(keys.tavilyApiKey || config.tavilyApiKey),
      llm: { provider: llm.provider || config.defaultLlm.provider || '', model: llm.model || config.defaultLlm.model || '' },
    });
  });

  // ---- settings (BYOK keys live server-side, never logged) -------------
  app.get('/api/settings', (_req, res) => {
    const llm = store.getSetting('llm', {}) || {};
    const keys = store.getSetting('keys', {}) || {};
    res.json({
      llm: { provider: llm.provider || '', model: llm.model || '', baseUrl: llm.baseUrl || '', apiKey: mask(llm.apiKey) },
      keys: { composioApiKey: mask(keys.composioApiKey), tavilyApiKey: mask(keys.tavilyApiKey) },
    });
  });

  app.put('/api/settings', (req, res) => {
    const { llm = {}, keys = {} } = req.body || {};
    const currentLlm = store.getSetting('llm', {}) || {};
    const currentKeys = store.getSetting('keys', {}) || {};
    // Only overwrite a key when a real (non-masked) value is provided.
    const nextLlm = { ...currentLlm, ...pick(llm, ['provider', 'model', 'baseUrl']) };
    if (llm.apiKey && !isMasked(llm.apiKey)) nextLlm.apiKey = llm.apiKey;
    if (llm.apiKey === null) delete nextLlm.apiKey;
    const nextKeys = { ...currentKeys };
    for (const k of ['composioApiKey', 'tavilyApiKey']) {
      if (keys[k] && !isMasked(keys[k])) nextKeys[k] = keys[k];
      if (keys[k] === null) delete nextKeys[k];
    }
    store.setSetting('llm', nextLlm);
    store.setSetting('keys', nextKeys);
    res.json({ ok: true });
  });

  // ---- chat (streaming SSE) --------------------------------------------
  app.post('/api/chat', async (req, res) => {
    const body = req.body || {};
    const history = Array.isArray(body.messages) ? body.messages : [];
    if (!history.length) return res.status(400).json({ error: 'messages[] is required' });

    let llm;
    try {
      llm = resolveLLM(body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const ctx = toolContext(body);
    const memories = store.listMemories(ctx.userId, 20);
    const system = body.system || buildSystemPrompt({ memories });
    const messages = [{ role: 'system', content: system }, ...history.map(normalizeMsg)];

    sseInit(res);
    const ctrl = new AbortController();
    // Abort the run only if the client actually disconnects mid-stream.
    res.on('close', () => {
      if (!res.writableEnded) ctrl.abort();
    });

    try {
      const result = await runAgentLoop({
        llm,
        registry: tools,
        messages,
        ctx,
        emit: (ev) => sseSend(res, ev.type || 'event', ev),
        maxSteps: body.maxSteps || config.maxSteps,
        signal: ctrl.signal,
      });
      sseSend(res, 'done', { done: result.done, reason: result.reason, content: result.content, steps: result.steps });
    } catch (e) {
      log.error('chat failed:', e.message);
      sseSend(res, 'error', { error: e.message });
    } finally {
      res.end();
    }
  });

  // ---- agent (non-streaming JSON) --------------------------------------
  app.post('/api/agent', async (req, res) => {
    const body = req.body || {};
    const history = Array.isArray(body.messages) ? body.messages : [];
    if (!history.length) return res.status(400).json({ error: 'messages[] is required' });
    let llm;
    try {
      llm = resolveLLM(body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const ctx = toolContext(body);
    const system = body.system || buildSystemPrompt({ memories: store.listMemories(ctx.userId, 20) });
    const events = [];
    try {
      const result = await runAgentLoop({
        llm,
        registry: tools,
        messages: [{ role: 'system', content: system }, ...history.map(normalizeMsg)],
        ctx,
        emit: (ev) => events.push(ev),
        maxSteps: body.maxSteps || config.maxSteps,
      });
      res.json({ done: result.done, reason: result.reason, content: result.content, steps: result.steps, events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- conversations ---------------------------------------------------
  app.get('/api/conversations', (_req, res) =>
    res.json({ conversations: store.listConversations('local') }),
  );
  app.post('/api/conversations', (req, res) =>
    res.json(store.createConversation({ title: req.body?.title || 'New chat' })),
  );
  app.get('/api/conversations/:id/messages', (req, res) => {
    const conv = store.getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: 'not found' });
    res.json({ conversation: conv, messages: store.listMessages(req.params.id) });
  });

  // ---- memories --------------------------------------------------------
  app.get('/api/memories', (_req, res) => res.json({ memories: store.listMemories('local') }));
  app.post('/api/memories', (req, res) => {
    const { content, tags = [] } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content is required' });
    res.json(store.addMemory({ content, tags }));
  });

  // ---- long tasks ------------------------------------------------------
  app.get('/api/tasks', (_req, res) => res.json({ tasks: store.listTasks('local') }));
  app.post('/api/tasks', (req, res) => {
    const { goal, maxSteps = config.maxSteps, context = '', llm } = req.body || {};
    if (!goal) return res.status(400).json({ error: 'goal is required' });
    const task = store.createTask({
      goal,
      maxSteps,
      config: { seedContext: context, llm: llm || null },
    });
    worker?.tick?.();
    res.json(task);
  });
  app.get('/api/tasks/:id', (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    res.json(task);
  });
  app.post('/api/tasks/:id/cancel', (req, res) => {
    res.json({ ok: worker ? worker.cancel(req.params.id) : false });
  });
  app.post('/api/tasks/:id/resume', (req, res) => {
    res.json({ ok: worker ? worker.resume(req.params.id) : false });
  });

  // live event stream for a task (SSE)
  app.get('/api/tasks/:id/stream', (req, res) => {
    const taskId = req.params.id;
    sseInit(res);
    let lastId = Number(req.query.after || 0);
    for (const ev of store.listEvents(taskId, lastId)) {
      sseSend(res, ev.type, { ...ev.data, _id: ev.id });
      lastId = ev.id;
    }
    const onEvent = (ev) => {
      if (ev.taskId !== taskId) return;
      sseSend(res, ev.type, { ...ev.data, _id: ev.id });
      lastId = ev.id;
    };
    worker?.on?.('event', onEvent);
    const poll = setInterval(() => {
      for (const ev of store.listEvents(taskId, lastId)) {
        sseSend(res, ev.type, { ...ev.data, _id: ev.id });
        lastId = ev.id;
      }
      const t = store.getTask(taskId);
      if (t && ['done', 'failed', 'cancelled'].includes(t.status)) {
        sseSend(res, 'end', { status: t.status });
        cleanup();
      }
    }, 1000);
    const cleanup = () => {
      clearInterval(poll);
      worker?.off?.('event', onEvent);
      if (!res.writableEnded) res.end();
    };
    res.on('close', cleanup);
  });

  // ---- static PWA ------------------------------------------------------
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

  return { app, tools, resolveLLM, toolContext, sseInit, sseSend };
}

function normalizeMsg(m) {
  if (typeof m === 'string') return { role: 'user', content: m };
  return { role: m.role || 'user', content: m.content ?? '' };
}

const mask = (v) => (v ? `****${String(v).slice(-4)}` : '');
const isMasked = (v) => typeof v === 'string' && v.startsWith('****');
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
