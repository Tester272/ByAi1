// server/scripts/mock-llm.js
// A tiny OpenAI-compatible mock LLM used for local demos and end-to-end checks.
// Run: node scripts/mock-llm.js [port]
import http from 'node:http';

const port = Number(process.argv[2] || 9911);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {
      /* ignore */
    }
    const messages = payload.messages || [];
    const hasToolResult = messages.some((m) => m.role === 'tool');
    const userText = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const urlMatch = /(https?:\/\/[^\s"']+)/.exec(userText);

    let message;
    if (!hasToolResult) {
      const args = urlMatch ? { url: urlMatch[1] } : { query: userText.slice(0, 60) };
      const name = urlMatch ? 'web_fetch' : 'web_search';
      message = { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
    } else {
      const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
      message = { role: 'assistant', content: `Done. Tool result: ${String(lastTool.content).slice(0, 200)}` };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 10 } }));
  });
});

server.listen(port, () => console.log(`mock-llm listening on http://127.0.0.1:${port}/v1`));
