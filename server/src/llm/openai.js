// server/src/llm/openai.js
// OpenAI Chat Completions adapter. Also covers any OpenAI-compatible endpoint
// (Groq, Together, OpenRouter, Fireworks, Ollama, LM Studio, vLLM, ...).
import { LLMError, readError } from './errors.js';

function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content ?? '' };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        })),
      };
    }
    return { role: m.role, content: m.content ?? '' };
  });
}

export function openaiCompatible({ apiKey, model, baseUrl, provider, fetchImpl }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`;
  return {
    provider,
    model,
    async chat({ messages, tools = [], signal, temperature = 0.3 }) {
      const body = { model, messages: toOpenAIMessages(messages), temperature };
      if (tools.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      const res = await fetchImpl(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new LLMError(`${provider} request failed (${res.status})`, {
          status: res.status,
          provider,
          body: await readError(res),
        });
      }
      const data = await res.json();
      const choice = data.choices?.[0]?.message || {};
      const toolCalls = (choice.tool_calls || []).map((tc) => ({
        id: tc.id,
        name: tc.function?.name,
        args: safeParse(tc.function?.arguments),
      }));
      return { content: choice.content || '', toolCalls, usage: data.usage || null };
    },
  };
}

export function safeParse(str) {
  if (str == null) return {};
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return { _raw: String(str) };
  }
}
