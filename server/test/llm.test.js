// test/llm.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLLM, LLMError, PROVIDERS, defaultModel } from '../src/llm/provider.js';
import { fakeFetch, mockResponse } from './helpers.js';

test('exposes the expected providers', () => {
  assert.deepEqual(PROVIDERS, ['openai', 'anthropic', 'gemini', 'openai-compatible']);
  assert.equal(defaultModel('anthropic'), 'claude-3-5-sonnet-latest');
});

test('createLLM requires an api key', () => {
  assert.throws(() => createLLM({ provider: 'openai' }), LLMError);
});

test('openai adapter maps messages, tools and parses tool calls', async () => {
  const fetchImpl = fakeFetch([
    [
      '/chat/completions',
      mockResponse({
        choices: [
          {
            message: {
              content: 'calling a tool',
              tool_calls: [
                { id: 'c1', function: { name: 'web_fetch', arguments: '{"url":"https://x.com"}' } },
              ],
            },
          },
        ],
        usage: { total_tokens: 5 },
      }),
    ],
  ]);
  const llm = createLLM({ provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', fetchImpl });
  const res = await llm.chat({
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'p', name: 'web_fetch', args: { url: 'a' } }] },
      { role: 'tool', toolCallId: 'p', name: 'web_fetch', content: 'result' },
    ],
    tools: [{ type: 'function', function: { name: 'web_fetch', description: 'd', parameters: {} } }],
  });
  assert.equal(res.content, 'calling a tool');
  assert.equal(res.toolCalls[0].name, 'web_fetch');
  assert.deepEqual(res.toolCalls[0].args, { url: 'https://x.com' });
  assert.equal(res.usage.total_tokens, 5);

  // verify the outbound request body mapped assistant tool_calls + tool result
  const sent = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(sent.messages[2].tool_calls[0].function.name, 'web_fetch');
  assert.equal(sent.messages[3].role, 'tool');
  assert.equal(sent.messages[3].tool_call_id, 'p');
  assert.equal(sent.tool_choice, 'auto');
});

test('anthropic adapter maps system, tools and tool_use blocks', async () => {
  const fetchImpl = fakeFetch([
    [
      '/messages',
      mockResponse({
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 't1', name: 'web_search', input: { query: 'x' } },
        ],
        usage: { input_tokens: 1 },
      }),
    ],
  ]);
  const llm = createLLM({ provider: 'anthropic', apiKey: 'k', fetchImpl });
  const res = await llm.chat({
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ],
    tools: [{ type: 'function', function: { name: 'web_search', description: 'd', parameters: { type: 'object' } } }],
  });
  assert.equal(res.content, 'ok');
  assert.equal(res.toolCalls[0].name, 'web_search');
  const sent = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(sent.system, 'sys');
  assert.equal(sent.tools[0].name, 'web_search');
  assert.equal(fetchImpl.calls[0].opts.headers['x-api-key'], 'k');
});

test('gemini adapter maps contents and parses functionCall', async () => {
  const fetchImpl = fakeFetch([
    [
      'generateContent',
      mockResponse({
        candidates: [
          { content: { parts: [{ text: 'hi' }, { functionCall: { name: 'current_time', args: {} } }] } },
        ],
      }),
    ],
  ]);
  const llm = createLLM({ provider: 'gemini', apiKey: 'k', fetchImpl });
  const res = await llm.chat({ messages: [{ role: 'user', content: 'time?' }], tools: [] });
  assert.equal(res.content, 'hi');
  assert.equal(res.toolCalls[0].name, 'current_time');
  assert.match(fetchImpl.calls[0].url, /key=k/);
});

test('adapter surfaces provider errors as LLMError with status', async () => {
  const fetchImpl = fakeFetch([['/chat/completions', mockResponse('bad key', { ok: false, status: 401 })]]);
  const llm = createLLM({ provider: 'openai', apiKey: 'bad', fetchImpl });
  await assert.rejects(
    () => llm.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof LLMError && err.status === 401,
  );
});
