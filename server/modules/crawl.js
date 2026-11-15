import { extractFromHtml } from '../lib/extract.js';
import { extractPeople, emailNameMatch, PEOPLE_PAGE } from '../lib/people.js';
import { registrableDomain } from '../../shared/entities.js';

const MAX_PAGES = 14;
const SHARED_BOX = /^(info|contact|kontakt|hello|hi|office|sales|support|help|admin|press|media|mail|team|jobs|careers|hr|privacy|legal|billing|marketing|webmaster|noreply|no-reply|enquiries|inquiries|service|post)@/;
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp[34]|css|js|ico|xml|rss)(\?|$)|\/(wp-json|feed|tag|category|cart|checkout|login|account)\b/i;

function links(html, base, site) {
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || registrableDomain(u.hostname) !== site || SKIP.test(u.pathname)) continue;
    u.hash = '';
    u.search = '';
    const text = m[2].replace(/<[^>]+>/g, ' ');
    const depth = u.pathname.split('/').filter(Boolean).length;
    let score = (PEOPLE_PAGE.test(u.pathname) ? 3 : 0) + (PEOPLE_PAGE.test(text) ? 2 : 0) - depth * 0.5;
    if (depth === 0) score = -5;
    if (!out.has(u.href) || out.get(u.href) < score) out.set(u.href, score);
  }
  return out;
}

export default {
  id: 'site_people', name: 'Crawl site for people & contacts', group: 'Web', source: 'target site', active: true, auto: false,
  description: `Visits the home page and up to ${MAX_PAGES - 1} team, about, contact and imprint pages; finds the people named there with their role, e-mail, phone, photo and social profiles.`,
  inputs: ['domain', 'url'],
  async run({ type, value }, ctx) {
    const opts = { maxBytes: 1_500_000, timeout: 12000, headers: { accept: 'text/html,*/*;q=0.8', 'accept-language': 'en' } };
    const get = async (u) => {
      const r = await ctx.http.raw(u, opts);
      return /html|^$/.test(r.headers.get('content-type') || '') ? { url: r.url || u, html: r.buf.toString('utf8') } : null;
    };
    let home;
    if (type === 'domain') { try { home = await get(`https://${value}/`); } catch { home = await get(`http://${value}/`); } }
    else home = await get(value);
    if (!home) return { entities: [], notes: ['The address did not return a web page.'] };

    const site = registrableDomain(new URL(home.url).hostname);
    const pages = [home];
    const seen = new Set([home.url, home.url.replace(/\/$/, '')]);
    const queue = new Map();
    const feed = (p, bonus = 0) => { for (const [u, s] of links(p.html, p.url, site)) if (!seen.has(u) && !seen.has(u.replace(/\/$/, ''))) queue.set(u, Math.max(queue.get(u) ?? -99, s + bonus)); };
    feed(home);
    const deadline = Date.now() + 45000;
    let failed = 0;
    while (pages.length < MAX_PAGES && queue.size && Date.now() < deadline) {
      const batch = [...queue.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(4, MAX_PAGES - pages.length)).filter(([, s], i) => s > 0 || (i === 0 && pages.length < 4));
      if (!batch.length) break;
      batch.forEach(([u]) => { queue.delete(u); seen.add(u); seen.add(u.replace(/\/$/, '')); });
      const got = await Promise.allSettled(batch.map(([u]) => get(u)));
      got.forEach((g, i) => {
        if (g.status !== 'fulfilled' || !g.value) { failed++; return; }
        pages.push(g.value);
        // pages linked from a people page (individual bios) are worth following too
        feed(g.value, PEOPLE_PAGE.test(new URL(batch[i][0]).pathname) ? 1.5 : -1);
      });
    }

    const people = new Map();
    const loose = { emails: new Set(), phones: new Set(), profiles: new Map(), orgs: new Set() };
    for (const p of pages) {
      for (const person of extractPeople(p.html, p.url)) {
        const k = person.name.toLowerCase();
        const cur = people.get(k);
        if (!cur) { people.set(k, { ...person, page: p.url }); continue; }
        cur.role ||= person.role; cur.image ||= person.image; cur.sure ||= person.sure;
        cur.emails.push(...person.emails); cur.phones.push(...person.phones); cur.profiles.push(...person.profiles);
      }
      const x = extractFromHtml(p.html, p.url);
      x.emails.forEach((e) => loose.emails.add(e));
      x.phones.forEach((t) => loose.phones.add(t));
      x.profiles.forEach((s) => loose.profiles.set(s.url.toLowerCase(), s));
      if (p === home) x.orgs.forEach((o) => loose.orgs.add(o));
    }

    // an address like jane.doe@ belongs to Jane Doe wherever on the site it was printed
    // a "name" made of the company's own words (site name, domain) is the company, not a person
    const words = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const own = new Set([...words(site.split('.')[0]), ...[...loose.orgs].flatMap(words)]);
    const list = [...people.values()].filter((p) => !words(p.name).every((w) => own.has(w))).slice(0, 40);
    for (const e of loose.emails) {
      const scored = list.map((p) => [emailNameMatch(e, p.name), p]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
      if (scored.length && (scored[0][0] === 2 || scored.length === 1) && (scored.length === 1 || scored[1][0] < scored[0][0])) { scored[0][1].emails.push(e); scored[0][1].sure = true; }
    }
    // details printed next to several people (a shared footer) are not personal
    const count = (pick) => { const c = new Map(); list.forEach((p) => new Set(pick(p)).forEach((v) => c.set(v, (c.get(v) || 0) + 1))); return c; };
    const ec = count((p) => p.emails), pc = count((p) => p.phones), sc = count((p) => p.profiles.map((s) => s.url.toLowerCase()));
    const entities = [];
    const owned = new Set();
    for (const p of list) {
      const pkey = `person:${p.name}`;
      entities.push({ type: 'person', value: p.name, rel: 'named on site', props: { role: p.role || undefined, found_on: p.page, confidence: p.sure ? undefined : 'candidate' } });
      for (const e of new Set(p.emails)) if (emailNameMatch(e, p.name) || (ec.get(e) === 1 && !SHARED_BOX.test(e))) { owned.add(e); entities.push({ type: 'email', value: e, rel: 'email', from: pkey }); }
      for (const t of new Set(p.phones)) if (pc.get(t) === 1) { owned.add(t); entities.push({ type: 'phone', value: t, rel: 'phone', from: pkey }); }
      for (const s of p.profiles) if (sc.get(s.url.toLowerCase()) === 1) { owned.add(s.url.toLowerCase()); entities.push({ type: 'profile', value: s.url, label: `${s.site}: ${s.username}`, rel: 'profile', from: pkey, props: { site: s.site, username: s.username } }); }
      if (p.image) entities.push({ type: 'photo', value: p.image, label: p.name, rel: 'portrait', from: pkey });
    }
    [...loose.orgs].slice(0, 2).forEach((o) => entities.push({ type: 'organization', value: o, rel: 'published by' }));
    [...loose.emails].filter((e) => !owned.has(e)).slice(0, 25).forEach((e) => entities.push({ type: 'email', value: e, rel: 'contact address' }));
    [...loose.phones].filter((t) => !owned.has(t)).slice(0, 10).forEach((t) => entities.push({ type: 'phone', value: t, rel: 'contact number' }));
    [...loose.profiles.values()].filter((s) => !owned.has(s.url.toLowerCase())).slice(0, 15).forEach((s) => entities.push({ type: 'profile', value: s.url, label: `${s.site}: ${s.username}`, rel: 'links to profile', props: { site: s.site, username: s.username } }));

    const notes = [`Read ${pages.length} page${pages.length > 1 ? 's' : ''}: ${pages.map((p) => new URL(p.url).pathname).join(', ')}.`];
    if (failed) notes.push(`${failed} page${failed > 1 ? 's' : ''} could not be loaded.`);
    if (!list.length) notes.push('No people recognised. Sites that build their pages with JavaScript, or show names only in images, cannot be read this way.');
    return { entities, props: { pages_crawled: pages.length, people_found: list.length }, notes };
  },
};
