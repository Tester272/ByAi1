// server/src/agent/loop.js
// The core agent loop: think -> call tools -> observe -> repeat until done.

export function stringifyResult(value, max = 20000) {
  let s;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s == null) s = '';
  return s.length > max ? s.slice(0, max) + `\n...[truncated ${s.length - max} chars]` : s;
}

/**
 * @param {object} args
 * @param {{chat: Function}} args.llm          provider client (from createLLM)
 * @param {import('../tools/registry.js').ToolRegistry} args.registry
 * @param {Array} args.messages                initial messages (system + history)
 * @param {object} [args.ctx]                  shared tool context (store, userId, ...)
 * @param {Function} [args.emit]               event callback for streaming
 * @param {number} [args.maxSteps]
 * @param {AbortSignal} [args.signal]
 * @param {string[]} [args.excludeTools]
 * @param {Function} [args.onCheckpoint]      called with (transcript, steps) after each step
 */
export async function runAgentLoop({
  llm,
  registry,
  messages,
  ctx = {},
  emit,
  maxSteps = 25,
  signal,
  excludeTools = [],
  onCheckpoint,
}) {
  const transcript = [...messages];
  const tools = registry.list({ exclude: excludeTools });
  let steps = 0;

  for (let step = 1; step <= maxSteps; step++) {
    steps = step;
    if (signal?.aborted) return { done: false, reason: 'aborted', transcript, steps };
    emit?.({ type: 'thinking', step });

    const res = await llm.chat({ messages: transcript, tools, signal });
    const assistantMsg = { role: 'assistant', content: res.content || '', toolCalls: res.toolCalls };
    transcript.push(assistantMsg);
    emit?.({
      type: 'assistant',
      step,
      content: res.content || '',
      toolCalls: res.toolCalls,
      usage: res.usage || null,
    });

    if (!res.toolCalls || res.toolCalls.length === 0) {
      return { done: true, content: res.content || '', transcript, steps };
    }

    for (const tc of res.toolCalls) {
      if (signal?.aborted) return { done: false, reason: 'aborted', transcript, steps };
      let result;
      let error = false;
      try {
        result = await registry.execute(tc.name, tc.args, { ...ctx, transcript });
      } catch (e) {
        error = true;
        result = { error: e.message };
      }
      emit?.({ type: 'tool', step, id: tc.id, name: tc.name, args: tc.args, result, error });
      transcript.push({
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        content: stringifyResult(result),
      });
      if (ctx.finished) {
        return { done: true, content: ctx.finished.result, transcript, steps, finishedByTool: true };
      }
    }

    onCheckpoint?.(transcript, steps);
  }

  return { done: false, reason: 'max_steps', transcript, steps };
}
