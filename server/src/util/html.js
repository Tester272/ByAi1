// server/src/util/html.js
// Dependency-free HTML helpers: entity decoding, tag stripping and text extraction.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '(c)', reg: '(r)', trade: '(tm)', hellip: '...', mdash: '-', ndash: '-',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', middot: '.', bull: '*',
  eacute: 'e', egrave: 'e', agrave: 'a', ccedil: 'c', uuml: 'u', ouml: 'o',
};

export function decodeEntities(str = '') {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code =
        ent[1] === 'x' || ent[1] === 'X'
          ? Number.parseInt(ent.slice(2), 16)
          : Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = ent.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
  });
}

export function extractTitle(html = '') {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).trim().slice(0, 300) : '';
}

export function stripHtml(html = '') {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, ' ');
  // block-level tags become newlines so the text keeps some structure
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|br|header|footer|nav)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Very small readability pass: drop obviously non-content lines.
export function extractReadable(html = '', { maxChars = 12000 } = {}) {
  const title = extractTitle(html);
  const text = stripHtml(html);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out = lines.join('\n').slice(0, maxChars);
  return { title, text: out };
}

export function extractLinks(html = '', base = '') {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    const label = stripHtml(m[2]).slice(0, 120);
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    let abs = href;
    try {
      abs = new URL(href, base || undefined).toString();
    } catch {
      /* keep raw */
    }
    links.push({ url: abs, text: label });
  }
  return links;
}
