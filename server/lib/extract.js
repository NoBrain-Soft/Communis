// Entity extraction from free text and HTML.
import { registrableDomain } from '../../shared/entities.js';

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi;
const NOT_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$|^(?:example|email|name|user|you|your|username)@|@(?:example\.|sentry\.|.*\.wixpress\.com)/i;
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]+/gi;
const IPV4_RE = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
const PHONE_RE = /(?<![\w.+])\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}(?!\w)/g;
const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;
const TLDS = 'com|net|org|io|co|dev|app|ai|info|biz|edu|gov|mil|int|me|tv|xyz|online|site|tech|cloud|us|uk|de|fr|nl|be|es|it|pt|ch|at|se|no|dk|fi|pl|cz|ru|ua|tr|gr|ie|eu|ca|mx|br|ar|cl|au|nz|jp|cn|kr|in|sg|hk|tw|za|il|ae|sa';
const DOMAIN_RE = new RegExp(`(?<![\\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})(?![\\w-])`, 'gi');

const RESERVED = new Set(['share', 'sharer', 'sharer.php', 'intent', 'home', 'login', 'signup', 'search', 'explore',
  'about', 'privacy', 'terms', 'tos', 'help', 'hashtag', 'i', 'settings', 'features', 'pricing', 'topics', 'orgs',
  'sponsors', 'marketplace', 'p', 'reel', 'reels', 'stories', 'tr', 'dialog', 'plugins', 'pages', 'groups', 'events',
  'watch', 'policies', 'legal', 'contact', 'jobs', 'careers', 'blog', 'docs', 'security', 'enterprise', 'site', 'join',
  'joinchat', 'addstickers', 's', 'accounts', 'developer', 'developers', 'business', 'ads', 'download', 'apps',
  'collections', 'trending', 'notifications', 'messages', 'customer', 'readme', 'new', 'issues', 'pulls']);

const SOCIAL = [
  { site: 'X', host: /^(?:www\.|mobile\.)?(?:twitter|x)\.com$/, path: /^\/@?([A-Za-z0-9_]{1,15})\/?$/, url: (u) => `https://x.com/${u}` },
  { site: 'GitHub', host: /^(?:www\.)?github\.com$/, path: /^\/([A-Za-z0-9-]{1,39})\/?$/, url: (u) => `https://github.com/${u}` },
  { site: 'GitLab', host: /^gitlab\.com$/, path: /^\/([A-Za-z0-9_.-]{2,60})\/?$/, url: (u) => `https://gitlab.com/${u}` },
  { site: 'LinkedIn', host: /^(?:[a-z]{2,3}\.)?linkedin\.com$/, path: /^\/(?:in|company)\/([^/]+)\/?$/ },
  { site: 'Instagram', host: /^(?:www\.)?instagram\.com$/, path: /^\/([A-Za-z0-9_.]{1,30})\/?$/, url: (u) => `https://www.instagram.com/${u}` },
  { site: 'Facebook', host: /^(?:www\.|m\.|[a-z]{2}-[a-z]{2}\.)?facebook\.com$/, path: /^\/people\/([^/]+)\/\d+\/?$/ },
  { site: 'Facebook', host: /^(?:www\.|m\.|[a-z]{2}-[a-z]{2}\.)?facebook\.com$/, path: /^\/([A-Za-z0-9.]{3,50})\/?$/, url: (u) => `https://www.facebook.com/${u}` },
  { site: 'Telegram', host: /^(?:t\.me|telegram\.me)$/, path: /^\/([A-Za-z0-9_]{4,32})\/?$/, url: (u) => `https://t.me/${u}` },
  { site: 'YouTube', host: /^(?:www\.)?youtube\.com$/, path: /^\/(?:@|c\/|user\/|channel\/)([^/]+)\/?$/ },
  { site: 'TikTok', host: /^(?:www\.)?tiktok\.com$/, path: /^\/@([^/]+)\/?$/ },
  { site: 'Reddit', host: /^(?:www\.|old\.)?reddit\.com$/, path: /^\/u(?:ser)?\/([^/]+)\/?$/, url: (u) => `https://www.reddit.com/user/${u}` },
  { site: 'Keybase', host: /^keybase\.io$/, path: /^\/([a-z0-9_]{2,16})\/?$/ },
  { site: 'Medium', host: /^(?:www\.)?medium\.com$/, path: /^\/@([^/]+)\/?$/ },
  { site: 'Bluesky', host: /^bsky\.app$/, path: /^\/profile\/([^/]+)\/?$/ },
  { site: 'Mastodon', host: /./, path: /^\/@([A-Za-z0-9_]{1,30})\/?$/ },
];

/** If the URL is a social-media profile, returns { site, username, url }. */
export function socialProfile(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  for (const s of SOCIAL) {
    if (!s.host.test(u.hostname)) continue;
    const m = u.pathname.match(s.path);
    if (!m) continue;
    const username = decodeURIComponent(m[1]);
    if (RESERVED.has(username.toLowerCase())) return null;
    return { site: s.site, username, url: s.url ? s.url(username) : `${u.origin}${u.pathname.replace(/\/$/, '')}` };
  }
  return null;
}

const uniq = (a) => [...new Set(a)];
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ');

export function findEmails(text) {
  return uniq((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase().replace(/\.$/, ''))).filter((e) => !NOT_EMAIL.test(e));
}

/** Entities found in pasted text (reports, logs, e-mail headers, ...). */
export function extractFromText(text) {
  const out = [];
  const add = (type, value, extra) => out.push({ type, value, ...extra });
  const emails = findEmails(text);
  emails.forEach((e) => add('email', e));
  let rest = text.replace(EMAIL_RE, ' ');
  const urls = uniq((rest.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?'"]+$/, '')));
  for (const u of urls) {
    const sp = socialProfile(u);
    if (sp) add('profile', sp.url, { label: `${sp.site}: ${sp.username}`, props: { site: sp.site, username: sp.username } });
    else add('url', u);
  }
  rest = rest.replace(URL_RE, ' ');
  uniq(rest.match(CVE_RE) || []).forEach((c) => add('vulnerability', c));
  uniq(rest.match(IPV4_RE) || []).forEach((ip) => add('ip', ip));
  uniq(rest.match(PHONE_RE) || []).forEach((p) => add('phone', p));
  uniq((rest.replace(IPV4_RE, ' ').match(DOMAIN_RE) || []).map((d) => d.toLowerCase())).forEach((d) => add('domain', d));
  return out;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
};

function jsonLd(html) {
  const items = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') { items.push(n); Object.values(n).forEach((v) => typeof v === 'object' && walk(v)); }
      };
      walk(JSON.parse(m[1]));
    } catch { /* malformed JSON-LD is common; ignore */ }
  }
  return items;
}

/** Structured facts from a web page. */
export function extractFromHtml(html, baseUrl) {
  const base = new URL(baseUrl);
  const res = { title: '', description: '', generator: '', emails: [], phones: [], profiles: [], images: [], people: [], orgs: [], externalDomains: [] };
  res.title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 200);

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    const content = attr(tag, 'content');
    if (!name || !content) continue;
    if (name === 'description' || name === 'og:description') res.description ||= content.slice(0, 300);
    else if (name === 'generator') res.generator = content;
    else if (name === 'author' && content.length < 60 && !/^https?:/.test(content)) res.people.push(content);
    else if (name === 'og:site_name') res.orgs.push(content);
    else if (name === 'og:image' || name === 'twitter:image') { try { res.images.push(new URL(content, base).href); } catch { /* bad URL */ } }
    else if (name === 'twitter:site' || name === 'twitter:creator') {
      const h = content.replace(/^@/, '');
      if (/^[A-Za-z0-9_]{1,15}$/.test(h)) res.profiles.push({ site: 'X', username: h, url: `https://x.com/${h}` });
    }
  }

  for (const n of jsonLd(html)) {
    const t = [].concat(n['@type'] || []).join(' ');
    if (typeof n.name !== 'string' || n.name.length > 80) continue;
    if (/\bPerson\b/.test(t)) res.people.push(n.name);
    else if (/Organization|Corporation|LocalBusiness/.test(t)) res.orgs.push(n.name);
    if (typeof n.email === 'string') res.emails.push(n.email.replace(/^mailto:/, '').toLowerCase());
    if (typeof n.telephone === 'string') res.phones.push(n.telephone);
    [].concat(n.sameAs || []).forEach((s) => { const sp = typeof s === 'string' && socialProfile(s); if (sp) res.profiles.push(sp); });
  }

  const domains = new Map();
  const ownDomain = registrableDomain(base.hostname);
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href) continue;
    if (/^mailto:/i.test(href)) { try { res.emails.push(decodeURIComponent(href.replace(/^(?:mailto:)+/i, '').split('?')[0]).trim().toLowerCase()); } catch { /* bad escape */ } continue; }
    if (/^tel:/i.test(href)) { res.phones.push(decodeURIComponent(href.slice(4))); continue; }
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const sp = socialProfile(u.href);
    if (sp) { res.profiles.push(sp); continue; }
    const d = registrableDomain(u.hostname);
    if (d !== ownDomain) domains.set(u.hostname, (domains.get(u.hostname) || 0) + 1);
  }
  res.externalDomains = [...domains.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);

  const text = decodeEntities(html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
  res.emails.push(...findEmails(text).filter((e) => !/^mailto/.test(e)));
  res.emails = uniq(res.emails.map((e) => e.replace(/^mailto:?(?=[a-z0-9._%+-]+@)/, ''))).filter((e) => !NOT_EMAIL.test(e));
  res.phones = uniq(res.phones);
  res.people = uniq(res.people);
  res.orgs = uniq(res.orgs);
  res.images = uniq(res.images);
  res.profiles = [...new Map(res.profiles.map((p) => [p.url.toLowerCase(), p])).values()];
  return res;
}
