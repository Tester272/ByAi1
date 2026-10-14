// test/loop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/agent/loop.js';
import { ToolRegistry, defineTool } from '../src/tools/registry.js';
import { scriptedLLM } from './helpers.js';

function echoRegistry() {
  return new ToolRegistry([
    defineTool('echo', 'echoes', { type: 'object', properties: { text: { type: 'string' } } }, async ({ text }) => ({ echoed: text })),
    defineTool('boom', 'always throws', { type: 'object', properties: {} }, async () => {
      throw new Error('kaboom');
    }),
    defineTool('finish_task', 'finish', { type: 'object', properties: { result: { type: 'string' } } }, async ({ result }, ctx) => {
      ctx.finished = { result };
      return { done: true };
    }),
  ]);
}

test('loop runs tools then returns the final answer', async () => {
  const llm = scriptedLLM([
    { toolCalls: [{ id: '1', name: 'echo', args: { text: 'hi' } }] },
    { content: 'all done' },
  ]);
  const events = [];
  const result = await runAgentLoop({
    llm,
    registry: echoRegistry(),
    messages: [{ role: 'user', content: 'go' }],
    emit: (e) => events.push(e.type),
  });
  assert.equal(result.done, true);
  assert.equal(result.content, 'all done');
  assert.equal(result.steps, 2);
  // transcript must include the tool result fed back to the model
  const toolMsg = result.transcript.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /echoed/);
  assert.deepEqual(events, ['thinking', 'assistant', 'tool', 'thinking', 'assistant']);
});

test('loop stops immediately when finish_task sets ctx.finished', async () => {
  const llm = scriptedLLM([{ toolCalls: [{ id: '1', name: 'finish_task', args: { result: 'the answer' } }] }]);
  const result = await runAgentLoop({ llm, registry: echoRegistry(), messages: [{ role: 'user', content: 'go' }] });
  assert.equal(result.done, true);
  assert.equal(result.content, 'the answer');
  assert.equal(result.finishedByTool, true);
  assert.equal(llm.calls.length, 1);
});

test('tool errors are captured and fed back, not thrown', async () => {
  const llm = scriptedLLM([
    { toolCalls: [{ id: '1', name: 'boom', args: {} }] },
    { content: 'recovered' },
  ]);
  const events = [];
  const result = await runAgentLoop({
    llm,
    registry: echoRegistry(),
    messages: [{ role: 'user', content: 'go' }],
    emit: (e) => events.push(e),
  });
  assert.equal(result.done, true);
  const toolEvent = events.find((e) => e.type === 'tool');
  assert.equal(toolEvent.error, true);
  assert.match(result.transcript.find((m) => m.role === 'tool').content, /kaboom/);
});

test('loop stops at maxSteps and reports the reason', async () => {
  const llm = scriptedLLM([{ toolCalls: [{ id: 'x', name: 'echo', args: { text: 'again' } }] }]);
  const result = await runAgentLoop({ llm, registry: echoRegistry(), messages: [{ role: 'user', content: 'go' }], maxSteps: 3 });
  assert.equal(result.done, false);
  assert.equal(result.reason, 'max_steps');
  assert.equal(result.steps, 3);
});

test('onCheckpoint is called after each step for resumability', async () => {
  const llm = scriptedLLM([
    { toolCalls: [{ id: '1', name: 'echo', args: { text: 'a' } }] },
    { content: 'done' },
  ]);
  const checkpoints = [];
  await runAgentLoop({
    llm,
    registry: echoRegistry(),
    messages: [{ role: 'user', content: 'go' }],
    onCheckpoint: (t, s) => checkpoints.push(s),
  });
  assert.deepEqual(checkpoints, [1]);
});
