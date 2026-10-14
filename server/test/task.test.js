// test/task.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store/db.js';
import { TaskWorker } from '../src/agent/worker.js';
import { ToolRegistry, defineTool } from '../src/tools/registry.js';
import { scriptedLLM } from './helpers.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 3000, interval = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await delay(interval);
  }
  throw new Error('waitFor timed out');
}

function makeRegistry() {
  return new ToolRegistry([
    defineTool('echo', 'echo', { type: 'object', properties: { t: { type: 'string' } } }, async ({ t }) => ({ echoed: t })),
    defineTool('task_update', 'update', { type: 'object', properties: { note: { type: 'string' } } }, async (_a, ctx) => {
      ctx.store.updateTask(ctx.taskId, { plan: ['step one'] });
      return { updated: true };
    }),
  ]);
}

test('worker runs a queued long task to completion and records events', async () => {
  const store = new Store(':memory:');
  const worker = new TaskWorker({
    store,
    registry: makeRegistry(),
    resolveLLM: () => scriptedLLM([{ content: 'the report is ready' }]),
    pollMs: 20,
  });
  const task = store.createTask({ goal: 'write a report', maxSteps: 5 });
  worker.start();
  await waitFor(() => ['done', 'failed'].includes(store.getTask(task.id).status));
  const done = store.getTask(task.id);
  assert.equal(done.status, 'done');
  assert.equal(done.result.text, 'the report is ready');
  const types = store.listEvents(task.id).map((e) => e.type);
  assert.ok(types.includes('task_started'));
  assert.ok(types.includes('task_done'));
  worker.stop();
  store.close();
});

test('worker pauses at the step cap and can resume', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const worker = new TaskWorker({
    store,
    registry: makeRegistry(),
    resolveLLM: () => ({
      async chat() {
        calls += 1;
        if (calls <= 2) return { content: '', toolCalls: [{ id: '1', name: 'echo', args: { t: 'x' } }] };
        return { content: 'finally done', toolCalls: [] };
      },
    }),
    pollMs: 20,
  });
  const task = store.createTask({ goal: 'long job', maxSteps: 2 });
  worker.start();
  await waitFor(() => store.getTask(task.id).status === 'paused');
  assert.equal(store.getTask(task.id).status, 'paused');
  // checkpoints were persisted during the run
  assert.ok(store.getTask(task.id).transcript.length > 0);

  assert.equal(worker.resume(task.id), true);
  await waitFor(() => store.getTask(task.id).status === 'done');
  assert.equal(store.getTask(task.id).result.text, 'finally done');
  worker.stop();
  store.close();
});

test('worker can cancel a running task', async () => {
  const store = new Store(':memory:');
  const worker = new TaskWorker({
    store,
    registry: makeRegistry(),
    resolveLLM: () => ({
      async chat() {
        await delay(80);
        return { content: '', toolCalls: [{ id: '1', name: 'echo', args: { t: 'x' } }] };
      },
    }),
    pollMs: 20,
  });
  const task = store.createTask({ goal: 'never ends', maxSteps: 50 });
  worker.start();
  await waitFor(() => store.getTask(task.id).status === 'running');
  assert.equal(worker.cancel(task.id), true);
  await waitFor(() => store.getTask(task.id).status === 'cancelled');
  worker.stop();
  store.close();
});

test('requeueInterrupted resets mid-flight tasks so they survive a restart', () => {
  const store = new Store(':memory:');
  const t = store.createTask({ goal: 'x', status: 'running' });
  store.updateTask(t.id, { status: 'running' });
  const n = store.requeueInterrupted();
  assert.equal(n, 1);
  assert.equal(store.getTask(t.id).status, 'queued');
  store.close();
});

test('a failing task is marked failed with the error message', async () => {
  const store = new Store(':memory:');
  const worker = new TaskWorker({
    store,
    registry: makeRegistry(),
    resolveLLM: () => ({
      async chat() {
        throw new Error('provider exploded');
      },
    }),
    pollMs: 20,
  });
  const task = store.createTask({ goal: 'doomed' });
  worker.start();
  await waitFor(() => store.getTask(task.id).status === 'failed');
  assert.match(store.getTask(task.id).error, /provider exploded/);
  worker.stop();
  store.close();
});
