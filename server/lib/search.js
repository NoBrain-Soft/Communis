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
  if (!out.length && /anomaly|captcha|challenge/i.test(html)) throw new Error('DuckDuckGo is rate-limiting automated searches right now. Try again later or use the search links below.');
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
