// mobile/test/api.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient } from '../src/lib/api.ts';

function fakeFetch(routes: Record<string, any>) {
  const calls: string[] = [];
  const fn = async (url: string, init?: any) => {
    calls.push(url);
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const r = routes[key];
        return {
          ok: r.ok !== false,
          status: r.status ?? 200,
          headers: { get: () => (r.text ? 'text/plain' : 'application/json') },
          json: async () => r.body,
          text: async () => JSON.stringify(r.body),
        };
      }
    }
    throw new Error('no route for ' + url);
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

test('runAgent posts messages and returns the result', async () => {
  const { fn, calls } = fakeFetch({
    '/api/agent': { body: { done: true, content: 'hi', steps: 1, events: [] } },
  });
  const client = new AgentClient('http://x:8787/', fn);
  const res = await client.runAgent([{ role: 'user', content: 'yo' }]);
  assert.equal(res.content, 'hi');
  assert.equal(calls[0], 'http://x:8787/api/agent');
});

test('listTasks unwraps the tasks array', async () => {
  const { fn } = fakeFetch({ '/api/tasks': { body: { tasks: [{ id: 't1', goal: 'g' }] } } });
  const client = new AgentClient('http://x:8787', fn);
  const tasks = await client.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 't1');
});

test('createTask sends goal and maxSteps', async () => {
  let sent: any;
  const fn = (async (url: string, init: any) => {
    sent = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 't2', goal: 'g', status: 'queued' }),
    };
  }) as unknown as typeof fetch;
  const client = new AgentClient('http://x:8787', fn);
  await client.createTask('do a big thing', 40);
  assert.equal(sent.goal, 'do a big thing');
  assert.equal(sent.maxSteps, 40);
});

test('errors surface the server error message', async () => {
  const { fn } = fakeFetch({ '/api/agent': { ok: false, status: 400, body: { error: 'Missing API key' } } });
  const client = new AgentClient('http://x:8787', fn);
  await assert.rejects(() => client.runAgent([{ role: 'user', content: 'x' }]), /Missing API key/);
});

test('cancelTask and resumeTask hit the right endpoints', async () => {
  const { fn, calls } = fakeFetch({ '/api/tasks/': { body: { ok: true } } });
  const client = new AgentClient('http://x:8787', fn);
  await client.cancelTask('t9');
  await client.resumeTask('t9');
  assert.match(calls[0], /\/api\/tasks\/t9\/cancel$/);
  assert.match(calls[1], /\/api\/tasks\/t9\/resume$/);
});
