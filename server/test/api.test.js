// test/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store/db.js';
import { createRegistry } from '../src/tools/index.js';
import { TaskWorker } from '../src/agent/worker.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { mockResponse } from './helpers.js';

const PAGE = '<html><head><title>Doc</title></head><body><p>agent content here</p></body></html>';

// Stateful fake fetch: first LLM call asks to fetch a page, second summarises.
function buildFetch() {
  let llmCalls = 0;
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push(String(url));
    if (String(url).includes('/chat/completions')) {
      llmCalls += 1;
      if (llmCalls === 1) {
        return mockResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  { id: 't1', function: { name: 'web_fetch', arguments: '{"url":"https://docs.test/page"}' } },
                ],
              },
            },
          ],
        });
      }
      return mockResponse({ choices: [{ message: { content: 'Summary: agent content here' } }] });
    }
    if (String(url).includes('docs.test')) {
      return mockResponse(PAGE, { contentType: 'text/html' });
    }
    throw new Error('unexpected url ' + url);
  };
  fn.calls = calls;
  return fn;
}

async function withServer(run) {
  const config = { ...loadConfig(), dbFile: ':memory:', maxSteps: 5 };
  const store = new Store(':memory:');
  const fetchImpl = buildFetch();
  const registry = createRegistry(config, { fetchImpl });
  const worker = new TaskWorker({
    store,
    registry,
    resolveLLM: () => ({
      async chat() {
        return { content: 'task finished', toolCalls: [] };
      },
    }),
    pollMs: 20,
  });
  const { app } = createApp({ store, config, worker, registry, fetchImpl });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, store, worker });
  } finally {
    worker.stop();
    server.close();
    store.close();
  }
}

const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /api/health reports providers and tools', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/api/health');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.providers.includes('openai'));
    assert.ok(body.tools.includes('web_fetch'));
  });
});

test('POST /api/chat streams tool use then the final answer (SSE)', async () => {
  await withServer(async ({ base }) => {
    const res = await post(base, '/api/chat', {
      messages: [{ role: 'user', content: 'summarise docs.test' }],
      provider: 'openai',
      apiKey: 'test-key',
    });
    assert.equal(res.headers.get('content-type').includes('text/event-stream'), true);
    const text = await res.text();
    assert.match(text, /event: assistant/);
    assert.match(text, /event: tool/);
    assert.match(text, /"name":"web_fetch"/);
    assert.match(text, /Summary: agent content here/);
    assert.match(text, /event: done/);
  });
});

test('POST /api/agent returns JSON with the tool trace', async () => {
  await withServer(async ({ base }) => {
    const res = await post(base, '/api/agent', {
      messages: [{ role: 'user', content: 'go' }],
      provider: 'openai',
      apiKey: 'test-key',
    });
    const body = await res.json();
    assert.equal(body.done, true);
    assert.match(body.content, /Summary/);
    assert.ok(body.events.some((e) => e.type === 'tool' && e.name === 'web_fetch'));
  });
});

test('chat without an API key returns a helpful 400', async () => {
  await withServer(async ({ base }) => {
    const res = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /API key/);
  });
});

test('long-task lifecycle over the REST API: create, run, complete', async () => {
  await withServer(async ({ base, store, worker }) => {
    worker.start();
    const created = await (await post(base, '/api/tasks', { goal: 'summarise everything' })).json();
    assert.ok(created.id);
    let task;
    for (let i = 0; i < 100; i++) {
      task = await (await fetch(`${base}/api/tasks/${created.id}`)).json();
      if (task.status === 'done') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(task.status, 'done');
    assert.equal(task.result.text, 'task finished');

    const list = await (await fetch(base + '/api/tasks')).json();
    assert.equal(list.tasks.length, 1);

    // task event stream replays recorded events
    const stream = await (await fetch(`${base}/api/tasks/${created.id}/stream`)).text();
    assert.match(stream, /event: task_done/);
    store.close;
  });
});

test('settings round-trip masks secrets but keeps them usable', async () => {
  await withServer(async ({ base }) => {
    const put = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ llm: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest', apiKey: 'sk-secret-1234' } }),
    });
    assert.equal(put.status, 200);
    const got = await (await fetch(base + '/api/settings')).json();
    assert.equal(got.llm.provider, 'anthropic');
    assert.equal(got.llm.apiKey, '****1234');
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.hasLlmKey, true);
  });
});
