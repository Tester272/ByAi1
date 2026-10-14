// server/src/llm/anthropic.js
// Anthropic Messages API adapter (Claude models).
import { LLMError, readError } from './errors.js';

function toAnthropic(messages) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      rest.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content ?? '' },
        ],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
      }
      rest.push({ role: 'assistant', content });
      continue;
    }
    rest.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content ?? '' });
  }
  return { system, messages: rest };
}

export function anthropic({ apiKey, model, baseUrl, fetchImpl }) {
  const base = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  return {
    provider: 'anthropic',
    model,
    async chat({ messages, tools = [], signal, temperature = 0.3 }) {
      const { system, messages: msgs } = toAnthropic(messages);
      const body = { model, max_tokens: 4096, temperature, messages: msgs };
      if (system) body.system = system;
      if (tools.length) {
        body.tools = tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
      }
      const res = await fetchImpl(`${base}/messages`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new LLMError(`anthropic request failed (${res.status})`, {
          status: res.status,
          provider: 'anthropic',
          body: await readError(res),
        });
      }
      const data = await res.json();
      let content = '';
      const toolCalls = [];
      for (const block of data.content || []) {
        if (block.type === 'text') content += block.text;
        else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
        }
      }
      return { content, toolCalls, usage: data.usage || null };
    },
  };
}
