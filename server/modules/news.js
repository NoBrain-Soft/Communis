import { webSearch, googleNews } from '../lib/search.js';

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export default {
  id: 'news_search', name: 'News & press mentions', group: 'Web', source: 'Google News + your news sites', auto: false,
  description: 'Articles that mention the exact name: Google News for the region set in Settings, plus a search restricted to the news sites listed there (for example a regional paper).',
  inputs: ['person', 'organization', 'technology', 'phrase', 'domain', 'username', 'email', 'vulnerability'],
  async run({ value }, ctx) {
    const sites = String(ctx.settings.newsSites || '').split(/[\s,;]+/).map((x) => x.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)).slice(0, 8);
    const entities = [];
    const notes = [];
    const errors = [];
    const seen = new Set();
    const add = (url, title, props) => {
      const key = title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return;
      seen.add(key);
      entities.push({ type: 'url', value: url, label: title.slice(0, 110), rel: 'mentioned in', props: { title, kind: 'news article', ...props } });
    };
    try {
      (await googleNews(`"${value}"`, ctx.settings.newsRegion, ctx)).slice(0, 12).forEach((n) => add(n.link, n.title, { source: n.source || hostOf(n.sourceUrl), published: n.published }));
    } catch (e) { errors.push(e); notes.push(`Google News: ${e.message}`); }
    if (sites.length) {
      try {
        // news aggregators do not index every local paper, so ask a web search engine for those sites directly
        const hits = await webSearch(`"${value}" ${sites.length > 1 ? `(${sites.map((s) => `site:${s}`).join(' OR ')})` : `site:${sites[0]}`}`, ctx);
        hits.filter((h) => sites.some((s) => hostOf(h.href).endsWith(s))).slice(0, 12).forEach((h) => add(h.href, h.title, { source: hostOf(h.href) }));
      } catch (e) { errors.push(e); notes.push(`Search on ${sites.join(', ')}: ${e.message}`); }
    } else notes.push('Tip: list your own news sites (e.g. a regional paper) in Settings to search them as well.');
    if (errors.length === (sites.length ? 2 : 1)) throw errors[0];
    return { entities, notes };
  },
};
