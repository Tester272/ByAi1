// test/tools.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/tools/index.js';
import { stripHtml, decodeEntities, extractLinks } from '../src/util/html.js';
import { Store } from '../src/store/db.js';
import { fakeFetch, mockResponse } from './helpers.js';

test('html helpers decode entities and strip markup', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#65;'), 'a & b <c> A');
  const text = stripHtml('<h1>Hi</h1><script>bad()</script><p>World</p>');
  assert.match(text, /Hi/);
  assert.match(text, /World/);
  assert.doesNotMatch(text, /bad\(\)/);
  const links = extractLinks('<a href="/x">X</a>', 'https://site.com/a');
  assert.equal(links[0].url, 'https://site.com/x');
});

test('registry exposes the full default toolset', () => {
  const r = createRegistry({});
  const names = r.names();
  for (const n of ['web_fetch', 'web_search', 'http_request', 'memory_save', 'memory_recall', 'task_create', 'finish_task', 'composio_search', 'composio_execute']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  assert.ok(r.list()[0].function.name);
});

test('web_fetch reads and extracts readable text from a page', async () => {
  const fetchImpl = fakeFetch([
    ['example.com', mockResponse('<html><head><title>T</title></head><body><p>Hello world</p></body></html>', { contentType: 'text/html' })],
  ]);
  const r = createRegistry({}, { fetchImpl });
  const out = await r.execute('web_fetch', { url: 'https://example.com' });
  assert.equal(out.title, 'T');
  assert.match(out.text, /Hello world/);
});

test('web_fetch parses JSON responses', async () => {
  const fetchImpl = fakeFetch([['api.test', mockResponse({ a: 1 }, { contentType: 'application/json' })]]);
  const r = createRegistry({}, { fetchImpl });
  const out = await r.execute('web_fetch', { url: 'https://api.test/x' });
  assert.deepEqual(out.json, { a: 1 });
});

test('web_search uses Tavily when a key is present', async () => {
  const fetchImpl = fakeFetch([
    ['api.tavily.com', mockResponse({ results: [{ title: 'A', url: 'https://a', content: 'snip' }] })],
  ]);
  const r = createRegistry({ tavilyApiKey: 'tk' }, { fetchImpl });
  const out = await r.execute('web_search', { query: 'x' });
  assert.equal(out.provider, 'tavily');
  assert.equal(out.results[0].title, 'A');
});

test('http_request performs arbitrary API calls', async () => {
  const fetchImpl = fakeFetch([['api.test', mockResponse('pong', { contentType: 'text/plain' })]]);
  const r = createRegistry({}, { fetchImpl });
  const out = await r.execute('http_request', { method: 'POST', url: 'https://api.test/echo', body: 'ping' });
  assert.equal(out.status, 200);
  assert.equal(out.body, 'pong');
});

test('memory tools persist and recall through the store', async () => {
  const store = new Store(':memory:');
  const r = createRegistry({});
  const ctx = { store, userId: 'u1' };
  await r.execute('memory_save', { content: 'user loves espresso', tags: ['pref'] }, ctx);
  const found = await r.execute('memory_recall', { query: 'espresso' }, ctx);
  assert.equal(found.count, 1);
  assert.match(found.memories[0].content, /espresso/);
});

test('composio tools require a key and explain how to fix it', async () => {
  const r = createRegistry({});
  await assert.rejects(() => r.execute('composio_search', { query: 'gmail' }), /Composio API key/);
});

test('composio_execute posts to the execute endpoint', async () => {
  const fetchImpl = fakeFetch([['/tools/execute/', mockResponse({ successful: true })]]) ;
  const r = createRegistry({ composioApiKey: 'ck' }, { fetchImpl });
  const out = await r.execute('composio_execute', { toolSlug: 'GMAIL_SEND_EMAIL', arguments: { to: 'a@b.c' } });
  assert.equal(out.successful, true);
  assert.equal(fetchImpl.calls[0].opts.headers['x-api-key'], 'ck');
});

test('unknown tool throws', async () => {
  const r = createRegistry({});
  await assert.rejects(() => r.execute('nope', {}), /Unknown tool/);
});
