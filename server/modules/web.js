import tls from 'node:tls';
import { extractFromHtml, socialProfile } from '../lib/extract.js';
import { isIP, registrableDomain } from '../../shared/entities.js';

const SIGNATURES = [
  [/wp-content|wp-includes/i, 'WordPress'], [/cdn\.shopify\.com/i, 'Shopify'], [/__NEXT_DATA__|\/_next\/static/, 'Next.js'],
  [/\/_nuxt\//, 'Nuxt'], [/drupal-settings-json|\/sites\/default\/files/i, 'Drupal'], [/\/media\/jui\/|com_content/i, 'Joomla'],
  [/static\.wixstatic\.com/i, 'Wix'], [/squarespace\.com/i, 'Squarespace'], [/ghost\.(io|org)|content="Ghost/i, 'Ghost'],
  [/googletagmanager\.com/i, 'Google Tag Manager'], [/js\.hs-scripts\.com|hubspot/i, 'HubSpot'], [/webflow/i, 'Webflow'],
];
const HEADER_TECH = [
  ['cf-ray', 'Cloudflare'], ['x-vercel-id', 'Vercel'], ['x-github-request-id', 'GitHub Pages'], ['x-amz-cf-id', 'Amazon CloudFront'],
  ['x-nf-request-id', 'Netlify'], ['x-fastly-request-id', 'Fastly'], ['x-shopify-stage', 'Shopify'], ['x-akamai-transformed', 'Akamai'],
];

const ASSET = /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|webp|mp4|json|xml|txt)(\?|$)/i;
const DOCUMENT = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|sql|bak|env|conf|log)(\?|$)/i;

/** DuckDuckGo HTML results as [{ href, title }]. */
async function ddg(query, ctx) {
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

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default [
  {
    id: 'web_scrape', name: 'Scrape web page', group: 'Web', source: 'target site',
    description: 'Fetches the page and extracts e-mails, phone numbers, social profiles, people, images, technologies and linked sites.',
    inputs: ['domain', 'url', 'profile'], active: true,
    async run({ type, value }, ctx) {
      let r;
      const opts = { maxBytes: 1_500_000, headers: { accept: 'text/html,*/*;q=0.8', 'accept-language': 'en' }, okStatuses: [401, 403, 404] };
      if (type === 'domain') {
        try { r = await ctx.http.raw(`https://${value}/`, opts); }
        catch { r = await ctx.http.raw(`http://${value}/`, opts); }
      } else r = await ctx.http.raw(value, opts);

      const entities = [];
      const props = { http_status: r.status };
      const final = r.url || value;
      if (type === 'domain') entities.push({ type: 'url', value: final, rel: 'serves' });
      const finalHost = new URL(final).hostname;
      if (type === 'domain' && registrableDomain(finalHost) !== registrableDomain(value)) entities.push({ type: 'domain', value: finalHost, rel: 'redirects to' });

      const tech = new Set();
      for (const h of ['server', 'x-powered-by', 'x-generator']) {
        const v = r.headers.get(h);
        if (v) { tech.add(v.split(/[;(]/)[0].trim().slice(0, 60)); props[h.replace(/^x-/, '').replace('-', '_')] = v.slice(0, 100); }
      }
      HEADER_TECH.forEach(([h, t]) => r.headers.has(h) && tech.add(t));

      const ctype = r.headers.get('content-type') || '';
      if (/html|xml|text/.test(ctype) || !ctype) {
        const html = r.buf.toString('utf8');
        const x = extractFromHtml(html, final);
        if (x.title) props.title = x.title;
        if (x.description) props.description = x.description;
        if (x.generator) tech.add(x.generator.slice(0, 60));
        SIGNATURES.forEach(([re, t]) => re.test(html) && tech.add(t));
        x.emails.slice(0, 25).forEach((e) => entities.push({ type: 'email', value: e, rel: 'mentions' }));
        x.phones.slice(0, 10).forEach((p) => entities.push({ type: 'phone', value: p, rel: 'mentions' }));
        x.profiles.slice(0, 20).forEach((p) => entities.push({ type: 'profile', value: p.url, label: `${p.site}: ${p.username}`, rel: 'links to profile', props: { site: p.site, username: p.username } }));
        x.people.slice(0, 8).forEach((p) => entities.push({ type: 'person', value: p, rel: 'names' }));
        x.orgs.slice(0, 4).forEach((o) => entities.push({ type: 'organization', value: o, rel: 'published by' }));
        x.images.slice(0, 3).forEach((i) => entities.push({ type: 'photo', value: i, rel: 'image' }));
        x.externalDomains.slice(0, 15).forEach((d) => entities.push({ type: 'domain', value: d, rel: 'links to' }));
      } else {
        props.content_type = ctype;
      }
      [...tech].filter(Boolean).forEach((t) => entities.push({ type: 'technology', value: t, rel: 'uses' }));
      return { entities, props };
    },
  },
  {
    id: 'crtsh', name: 'Subdomains from certificates', group: 'Infrastructure', source: 'crt.sh',
    description: 'Host names seen in publicly logged TLS certificates (Certificate Transparency).',
    inputs: ['domain'],
    async run({ value }, ctx) {
      const j = await ctx.http.json(`https://crt.sh/?q=${encodeURIComponent(`%.${value}`)}&output=json`, { timeout: 30000, maxBytes: 12_000_000 });
      const names = new Set();
      for (const row of j || []) {
        for (const n of String(row.name_value || '').split('\n')) {
          const d = n.trim().toLowerCase().replace(/^\*\./, '');
          if (d && d !== value && d.endsWith(`.${value}`) && !d.includes('@')) names.add(d);
        }
      }
      const list = [...names].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b));
      return {
        entities: list.slice(0, 60).map((d) => ({ type: 'domain', value: d, rel: 'subdomain', reverse: true })),
        props: { certificates_logged: (j || []).length },
        notes: list.length > 60 ? [`${list.length} subdomains found, showing the 60 shortest.`] : [],
      };
    },
  },
  {
    id: 'tls_cert', name: 'TLS certificate', group: 'Infrastructure', source: 'target host', active: true,
    description: 'Connects to port 443 and reads the certificate: alternative names, owner organisation, issuer.',
    inputs: ['domain', 'ip'],
    async run({ type, value }) {
      const cert = await new Promise((resolve, reject) => {
        const sock = tls.connect({ host: value, port: 443, servername: type === 'domain' ? value : undefined, rejectUnauthorized: false, timeout: 8000 }, () => {
          const c = sock.getPeerCertificate();
          sock.end();
          c && c.fingerprint256 ? resolve(c) : reject(new Error('No certificate presented'));
        });
        sock.on('timeout', () => { sock.destroy(); reject(new Error(`Timed out connecting to ${value}:443`)); });
        sock.on('error', (e) => reject(new Error(`TLS connection to ${value}:443 failed (${e.code || e.message})`)));
      });
      const fp = cert.fingerprint256.replace(/:/g, '').toLowerCase();
      const certKey = `certificate:${fp}`;
      const cn = [].concat(cert.subject?.CN || [])[0] || fp.slice(0, 16);
      const entities = [{
        type: 'certificate', value: fp, label: cn, rel: 'presents',
        props: { subject: cn, issuer: [].concat(cert.issuer?.O || cert.issuer?.CN || [])[0], valid_from: cert.valid_from, valid_to: cert.valid_to, serial: cert.serialNumber },
      }];
      const sans = String(cert.subjectaltname || '').split(',').map((s) => s.trim());
      for (const s of sans.slice(0, 50)) {
        if (s.startsWith('DNS:')) entities.push({ type: 'domain', value: s.slice(4), rel: 'valid for', from: certKey });
        else if (s.startsWith('IP Address:') && isIP(s.slice(11))) entities.push({ type: 'ip', value: s.slice(11), rel: 'valid for', from: certKey });
      }
      const org = [].concat(cert.subject?.O || [])[0];
      if (org) entities.push({ type: 'organization', value: org, rel: 'issued to', from: certKey });
      return { entities };
    },
  },
  {
    id: 'wayback', name: 'Archived pages', group: 'Web', source: 'Wayback Machine',
    description: 'Historic URLs, documents and forgotten sub-domains from the Internet Archive.',
    inputs: ['domain'],
    async run({ value }, ctx) {
      const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(value)}&matchType=domain&output=json&fl=original,timestamp,mimetype&collapse=urlkey&filter=statuscode:200&limit=1500`;
      const rows = (await ctx.http.json(q, { timeout: 30000, maxBytes: 6_000_000 }) || []).slice(1);
      const entities = [];
      const hosts = new Set();
      const docs = [];
      const pages = new Map();
      for (const [orig, ts] of rows) {
        let u;
        try { u = new URL(orig); } catch { continue; }
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (host !== value && host.endsWith(`.${value}`)) hosts.add(host);
        const clean = `${u.protocol}//${u.host}${u.pathname}`;
        const meta = { first_archived: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`, archive: `https://web.archive.org/web/${ts}/${orig}` };
        if (DOCUMENT.test(u.pathname)) docs.push({ value: clean, meta });
        else if (!ASSET.test(u.pathname) && u.pathname.split('/').filter(Boolean).length <= 2 && !pages.has(clean)) pages.set(clean, meta);
      }
      [...hosts].slice(0, 30).forEach((h) => entities.push({ type: 'domain', value: h, rel: 'subdomain', reverse: true }));
      docs.slice(0, 15).forEach((d) => entities.push({ type: 'url', value: d.value, rel: 'archived document', props: d.meta }));
      [...pages.entries()].slice(0, 15).forEach(([v, meta]) => entities.push({ type: 'url', value: v, rel: 'archived page', props: meta }));
      return { entities, props: { archived_urls: rows.length } };
    },
  },
  {
    id: 'web_search', name: 'Web search', group: 'Web', source: 'DuckDuckGo', auto: false,
    description: 'Top search results mentioning the exact value. Search engines may rate-limit automated queries.',
    inputs: ['person', 'email', 'username', 'phone', 'organization', 'phrase'],
    async run({ value }, ctx) {
      const entities = (await ddg(`"${value}"`, ctx)).slice(0, 10).map(({ href, title }) => {
        const sp = socialProfile(href);
        return sp ? { type: 'profile', value: sp.url, label: `${sp.site}: ${sp.username}`, rel: 'search result', props: { site: sp.site, username: sp.username, title, confidence: 'candidate' } }
          : { type: 'url', value: href, rel: 'search result', props: { title } };
      });
      return { entities };
    },
  },
  {
    id: 'social_search', name: 'Find social profiles', group: 'People', source: 'DuckDuckGo', auto: false,
    description: 'Searches LinkedIn, Facebook, X, Instagram and GitHub for profiles carrying this name, narrowed by the organisation or site the person is linked to in the graph. Candidates to verify, not confirmed matches.',
    inputs: ['person'],
    async run({ value, context }, ctx) {
      const hint = context?.orgs?.[0] || context?.domains?.[0]?.split('.')[0] || '';
      const last = fold(value).split(/\s+/).pop();
      const queries = [
        ['LinkedIn', `"${value}" ${hint} site:linkedin.com/in`],
        ['Facebook', `"${value}" ${hint} site:facebook.com`],
        ['other networks', `"${value}" ${hint} (site:x.com OR site:instagram.com OR site:github.com)`],
      ];
      const entities = [];
      const failed = [];
      let lastError;
      for (const [label, q] of queries) {
        try {
          let n = 0;
          for (const { href, title } of await ddg(q.replace(/\s+/g, ' '), ctx)) {
            const sp = socialProfile(href);
            if (!sp || !fold(`${title} ${decodeURIComponent(href)}`).includes(last)) continue;
            entities.push({ type: 'profile', value: sp.url, label: `${sp.site}: ${sp.username}`, rel: 'possible profile', props: { site: sp.site, username: sp.username, title, confidence: 'candidate' } });
            if (++n >= 3) break;
          }
        } catch (e) { failed.push(label); lastError = e; }
      }
      if (failed.length === queries.length) throw lastError;
      const notes = [hint ? `Searched with "${hint}" as context.` : 'No organisation linked to this person yet, so the search used the name alone; expect namesakes.'];
      if (failed.length) notes.push(`Search failed for: ${failed.join(', ')}.`);
      return { entities, notes };
    },
  },
];
