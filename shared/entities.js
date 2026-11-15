// Entity model shared by the server (module output normalisation) and the browser UI.

export const GROUPS = ['People', 'Context', 'Infrastructure'];

export const TYPES = {
  person:        { label: 'Person',        group: 'People',         color: '#f59e42' },
  username:      { label: 'Username',      group: 'People',         color: '#f7c948' },
  email:         { label: 'Email',         group: 'People',         color: '#ef6f6c' },
  phone:         { label: 'Phone',         group: 'People',         color: '#e889b5' },
  profile:       { label: 'Profile',       group: 'People',         color: '#c58af9' },
  photo:         { label: 'Photo',         group: 'People',         color: '#9aa5ff' },
  organization:  { label: 'Organization',  group: 'Context',        color: '#4fd1a5' },
  location:      { label: 'Location',      group: 'Context',        color: '#8fd16a' },
  phrase:        { label: 'Phrase',        group: 'Context',        color: '#a7b0bd' },
  domain:        { label: 'Domain',        group: 'Infrastructure', color: '#4aa8ff' },
  ip:            { label: 'IP address',    group: 'Infrastructure', color: '#22c3e6' },
  netblock:      { label: 'Netblock',      group: 'Infrastructure', color: '#6d8cff' },
  asn:           { label: 'AS number',     group: 'Infrastructure', color: '#8b7cf6' },
  url:           { label: 'URL',           group: 'Infrastructure', color: '#7fb2d9' },
  service:       { label: 'Service',       group: 'Infrastructure', color: '#f9865f' },
  certificate:   { label: 'Certificate',   group: 'Infrastructure', color: '#b8d45a' },
  technology:    { label: 'Technology',    group: 'Infrastructure', color: '#d9a441' },
  vulnerability: { label: 'Vulnerability', group: 'Infrastructure', color: '#ff4d5e' },
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/;

export const isIPv4 = (s) => IPV4.test(s);
export const isIPv6 = (s) => /^[0-9a-f:.]+$/i.test(s) && (s.match(/:/g) || []).length >= 2;
export const isIP = (s) => isIPv4(s) || isIPv6(s);
export const isDomain = (s) => DOMAIN.test(s) && !isIPv4(s);

// Two-label public suffixes we want to treat as one (not exhaustive; good enough to find a parent zone).
const MULTI_SUFFIX = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'com.mx', 'co.in', 'co.za', 'com.tr', 'com.sg', 'com.hk',
  'co.kr', 'com.tw', 'com.ar', 'co.il', 'com.ua', 'com.pl', 'github.io', 'herokuapp.com', 'vercel.app',
  'netlify.app', 'pages.dev', 'web.app', 'blogspot.com', 'wordpress.com']);

export function registrableDomain(host) {
  const p = host.split('.');
  if (p.length <= 2) return host;
  return MULTI_SUFFIX.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

function cleanUrl(v, keepHash = false) {
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!keepHash) u.hash = '';
    return u.href;
  } catch { return ''; }
}

/** Canonical form of a value for its type. Returns '' when the value is not valid for that type. */
export function normalize(type, raw) {
  let v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!v || !TYPES[type]) return '';
  switch (type) {
    case 'email': v = v.toLowerCase().replace(/^mailto:/, ''); return EMAIL.test(v) ? v : '';
    case 'domain':
      v = v.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#:].*$/, '').replace(/^\*\./, '').replace(/\.$/, '');
      return isDomain(v) ? v : '';
    case 'ip': v = v.toLowerCase().replace(/^\[|\]$/g, ''); return isIP(v) ? v : '';
    case 'netblock': { const [a, m] = v.toLowerCase().split('/'); return isIP(a) && /^\d{1,3}$/.test(m || '') ? `${a}/${m}` : ''; }
    case 'asn': { const m = v.match(/^(?:as)?(\d{1,10})$/i); return m ? `AS${m[1]}` : ''; }
    case 'url': return cleanUrl(v, true); // an anchor can address one item on a page (e.g. a press release)
    case 'profile': return cleanUrl(v).replace(/\/$/, '');
    case 'photo': return /^upload:\/\/[a-z0-9.]+$/.test(v) ? v : cleanUrl(v);
    case 'username': v = v.replace(/^@/, ''); return /^[^\s/@]{1,64}$/.test(v) ? v.toLowerCase() : '';
    case 'phone': { const d = v.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, ''); return d.replace(/\D/g, '').length >= 6 ? d : ''; }
    case 'vulnerability': return v.toUpperCase();
    case 'certificate': return v.toLowerCase().replace(/[^0-9a-f]/g, '').length >= 32 ? v.toLowerCase().replace(/[^0-9a-f]/g, '') : '';
    case 'service': return v.toLowerCase();
    default: return v.slice(0, 300);
  }
}

/** Identity of an entity in the graph: the same key means the same node. */
export function keyOf(type, value) {
  const n = normalize(type, value);
  return n ? `${type}:${n.toLowerCase()}` : '';
}

/** Best guess of the entity type for free-form input typed by the analyst. */
export function detectType(input) {
  const v = String(input || '').trim();
  if (!v) return 'phrase';
  if (EMAIL.test(v.toLowerCase())) return 'email';
  if (/^cve-\d{4}-\d+$/i.test(v)) return 'vulnerability';
  if (/^as\d{1,10}$/i.test(v)) return 'asn';
  if (/^[0-9a-f:.]+\/\d{1,3}$/i.test(v) && isIP(v.split('/')[0])) return 'netblock';
  if (isIP(v)) return 'ip';
  if (/^https?:\/\//i.test(v)) return /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(v) ? 'photo' : 'url';
  if (/^@[^\s/@]+$/.test(v)) return 'username';
  if (/^\+?[\d\s().-]{7,20}$/.test(v) && v.replace(/\D/g, '').length >= 7) return 'phone';
  if (isDomain(v.toLowerCase())) return 'domain';
  if (/^\p{Lu}[\p{L}'.-]*(\s+\p{Lu}[\p{L}'.-]*){1,3}$/u.test(v)) return 'person';
  if (/^[a-z0-9_.-]{3,32}$/i.test(v) && !/\s/.test(v)) return 'username';
  return 'phrase';
}
