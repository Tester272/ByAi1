// server/src/tools/web.js
// Tools that let the agent use ANY website: search, fetch/read pages, call APIs.
import { defineTool } from './registry.js';
import { extractReadable, extractLinks, stripHtml } from '../util/html.js';

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 MobileAgent/1.0';

async function fetchWithTimeout(fetchImpl, url, opts = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    return await fetchImpl(url, { redirect: 'follow', ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createWebTools({ fetchImpl = globalThis.fetch, tavilyApiKey = '' } = {}) {
  const webFetch = defineTool(
    'web_fetch',
    'Fetch any URL over HTTP(S) and return its readable content. Use this to read websites, docs, articles, JSON APIs, or raw HTML.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
        format: {
          type: 'string',
          enum: ['text', 'html', 'json', 'links'],
          description: 'text (default) = readable text, html = raw markup, json = parsed body, links = extracted links.',
        },
        maxChars: { type: 'number', description: 'Truncate output to this many characters (default 12000).' },
      },
      required: ['url'],
    },
    async ({ url, format = 'text', maxChars = 12000 }, ctx = {}) => {
      const f = ctx.fetchImpl || fetchImpl;
      if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');
      const res = await fetchWithTimeout(f, url, { headers: { 'user-agent': UA, accept: '*/*' } });
      const raw = await res.text();
      const contentType = res.headers?.get?.('content-type') || '';
      const meta = { url, status: res.status, contentType };

      if (format === 'json' || (format === 'text' && contentType.includes('application/json'))) {
        try {
          return { ...meta, json: JSON.parse(raw) };
        } catch {
          /* fall through to text */
        }
      }
      if (format === 'html') return { ...meta, html: raw.slice(0, maxChars) };
      if (format === 'links') return { ...meta, links: extractLinks(raw, url).slice(0, 100) };
      const { title, text } = extractReadable(raw, { maxChars });
      return {
        ...meta,
        title,
        text: contentType.includes('json') ? stripHtml(raw).slice(0, maxChars) : text,
      };
    },
    { category: 'web' },
  );

  const webSearch = defineTool(
    'web_search',
    'Search the web and get ranked results with titles, URLs and snippets. Use this to find pages before reading them with web_fetch.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        maxResults: { type: 'number', description: 'Number of results (default 5).' },
      },
      required: ['query'],
    },
    async ({ query, maxResults = 5 }, ctx = {}) => {
      const f = ctx.fetchImpl || fetchImpl;
      const key = ctx.tavilyApiKey || tavilyApiKey;
      if (key) {
        const res = await fetchWithTimeout(f, 'https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            query,
            max_results: maxResults,
            search_depth: 'basic',
          }),
        });
        const data = await res.json();
        return {
          provider: 'tavily',
          results: (data.results || []).slice(0, maxResults).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
          })),
        };
      }
      // Keyless fallback: DuckDuckGo HTML endpoint.
      const res = await fetchWithTimeout(
        f,
        'https://html.duckduckgo.com/html/',
        {
          method: 'POST',
          headers: {
            'user-agent': UA,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `q=${encodeURIComponent(query)}`,
        },
      );
      const html = await res.text();
      const results = [];
      const re =
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|$)/gi;
      let m;
      while ((m = re.exec(html)) && results.length < maxResults) {
        let url = m[1];
        const uddg = /[?&]uddg=([^&]+)/.exec(url);
        if (uddg) url = decodeURIComponent(uddg[1]);
        const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(m[3]);
        results.push({
          title: stripHtml(m[2]),
          url,
          snippet: snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 300) : '',
        });
      }
      return { provider: 'duckduckgo', results };
    },
    { category: 'web' },
  );

  const httpRequest = defineTool(
    'http_request',
    'Make a raw HTTP request to any API endpoint (GET/POST/PUT/PATCH/DELETE). Use for REST APIs, webhooks and integrations not covered by other tools.',
    {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
          description: 'HTTP method.',
        },
        url: { type: 'string', description: 'Absolute URL.' },
        headers: { type: 'object', description: 'Request headers as key/value pairs.' },
        body: { type: 'string', description: 'Request body string (stringify JSON yourself).' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 20000).' },
      },
      required: ['url'],
    },
    async ({ method = 'GET', url, headers = {}, body, timeoutMs = 20000 }, ctx = {}) => {
      const f = ctx.fetchImpl || fetchImpl;
      if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');
      const res = await fetchWithTimeout(
        f,
        url,
        {
          method,
          headers: { 'user-agent': UA, ...headers },
          body: method === 'GET' || method === 'HEAD' ? undefined : body,
        },
        timeoutMs,
      );
      const text = await res.text();
      return {
        status: res.status,
        contentType: res.headers?.get?.('content-type') || '',
        body: text.slice(0, 20000),
      };
    },
    { category: 'web', dangerous: true },
  );

  return [webFetch, webSearch, httpRequest];
}
