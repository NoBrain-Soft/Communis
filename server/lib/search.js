// Shared search-engine helpers.

/** DuckDuckGo HTML results as [{ href, title }]. */
export async function ddg(query, ctx) {
  const html = await ctx.http.text(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { accept: 'text/html', 'accept-language': 'en' } });
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let href = m[1].replace(/&amp;/g, '&');
    const redirect = href.match(/[?&]uddg=([^&]+)/);
    if (redirect) href = decodeURIComponent(redirect[1]);
    if (!/^https?:/.test(href) || seen.has(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    seen.add(href);
    out.push({ href, title: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim() });
  }
  if (!out.length && /anomaly|captcha|challenge/i.test(html)) throw new Error('DuckDuckGo is refusing automated searches from this network right now. Try again later, use the search links below, or set a search API in Settings.');
  return out;
}


/** Google News RSS items as [{ title, link, source, sourceUrl, published }]. region is "AT:de", "US:en", ... */
export async function googleNews(query, region, ctx) {
  const [gl, hl] = /^[A-Za-z]{2}:[A-Za-z-]{2,5}$/.test(region || '') ? region.split(':') : ['US', 'en'];
  const xml = await ctx.http.text(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl.toUpperCase()}&ceid=${gl.toUpperCase()}:${hl}`, { headers: { accept: 'application/rss+xml,text/xml' } });
  const un = (t) => (t || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (n) => un(m[1].match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`))?.[1]);
    const link = tag('link');
    if (!/^https?:/.test(link)) continue;
    const source = tag('source');
    const d = new Date(tag('pubDate'));
    out.push({ title: tag('title').replace(new RegExp(` - ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''), link, source, sourceUrl: un(m[1].match(/<source[^>]*url="([^"]+)"/)?.[1]), published: isNaN(d) ? undefined : d.toISOString().slice(0, 10) });
  }
  return out;
}

/**
 * Web search as [{ href, title }]. Uses, in this order: a Brave Search API key or a SearXNG instance if one is
 * set in Settings (both reliable), otherwise DuckDuckGo's HTML page (free, but it blocks some networks).
 */
export async function webSearch(query, ctx) {
  const s = ctx.settings || {};
  if (s.braveKey) {
    const j = await ctx.http.json(`https://api.search.brave.com/res/v1/web/search?count=20&q=${encodeURIComponent(query)}`, { headers: { 'x-subscription-token': s.braveKey } });
    return (j?.web?.results || []).map((r) => ({ href: r.url, title: String(r.title || '').replace(/<[^>]+>/g, '') })).filter((r) => /^https?:/.test(r.href));
  }
  if (/^https?:\/\//.test(s.searxUrl || '')) {
    const j = await ctx.http.json(`${s.searxUrl.replace(/\/+$/, '')}/search?format=json&q=${encodeURIComponent(query)}`);
    return (j?.results || []).map((r) => ({ href: r.url, title: r.title || '' })).filter((r) => /^https?:/.test(r.href));
  }
  return ddg(query, ctx);
}
