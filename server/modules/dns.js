import { Resolver } from 'node:dns/promises';
import { isIPv4, isIP, registrableDomain } from '../../shared/entities.js';

// ENOTFOUND is also what a machine without direct DNS access reports, so only "no such record" is trusted without asking DoH
const NO_DATA = new Set(['ENODATA']);

/** Resolve a record set as plain strings. Uses the system resolver, falls back to DNS-over-HTTPS. */
export async function resolve(name, type, ctx) {
  try {
    const r = new Resolver({ timeout: 3000, tries: 2 });
    const ans = type === 'PTR' ? await r.reverse(name) : await r.resolve(name, type);
    return ans.map((a) => (type === 'MX' ? a.exchange : type === 'TXT' ? a.join('') : String(a))).filter(Boolean);
  } catch (e) {
    if (NO_DATA.has(e.code)) return [];
  }
  let qname = name;
  if (type === 'PTR') {
    if (!isIPv4(name)) return [];
    qname = `${name.split('.').reverse().join('.')}.in-addr.arpa`;
  }
  const j = await ctx.http.json(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(qname)}&type=${type}`,
    { headers: { accept: 'application/dns-json' }, timeout: 8000 });
  const code = { A: 1, NS: 2, CNAME: 5, PTR: 12, MX: 15, TXT: 16, AAAA: 28 }[type];
  return (j?.Answer || []).filter((a) => a.type === code).map((a) => {
    let d = String(a.data);
    if (type === 'MX') d = d.split(/\s+/).pop();
    if (type === 'TXT') d = d.replace(/^"|"$/g, '').replace(/"\s+"/g, '');
    return d.replace(/\.$/, '');
  }).filter(Boolean);
}

const MAIL_PROVIDERS = [
  [/google\.com$|googlemail\.com$/, 'Google Workspace'], [/outlook\.com$|office365/, 'Microsoft 365'],
  [/protonmail|proton\.me/, 'Proton Mail'], [/zoho\./, 'Zoho Mail'], [/mimecast/, 'Mimecast'],
  [/pphosted\.com$/, 'Proofpoint'], [/fastmail|messagingengine/, 'Fastmail'], [/amazonaws\.com$/, 'Amazon SES'],
];

const TXT_SERVICES = [
  [/^google-site-verification=/i, 'Google Search Console'], [/^MS=ms/i, 'Microsoft 365'], [/^facebook-domain-verification=/i, 'Meta Business'],
  [/^atlassian-domain-verification=/i, 'Atlassian'], [/^apple-domain-verification=/i, 'Apple'], [/^docusign=/i, 'DocuSign'],
  [/^adobe-idp-site-verification=/i, 'Adobe'], [/^zoom-domain-verification=|^ZOOM_verify_/i, 'Zoom'], [/^stripe-verification=/i, 'Stripe'],
  [/^hubspot-developer-verification=/i, 'HubSpot'], [/^slack-domain-verification=/i, 'Slack'], [/^dropbox-domain-verification=/i, 'Dropbox'],
  [/^have-i-been-pwned-verification=/i, 'Have I Been Pwned'], [/^globalsign-domain-verification=/i, 'GlobalSign'], [/^cisco-ci-domain-verification=/i, 'Cisco Webex'],
  [/^onetrust-domain-verification=/i, 'OneTrust'], [/^miro-verification=/i, 'Miro'], [/^notion-domain-verification=/i, 'Notion'],
  [/^openai-domain-verification=/i, 'OpenAI'], [/^anthropic-domain-verification/i, 'Anthropic'], [/^mailru-verification/i, 'Mail.ru'], [/^yandex-verification/i, 'Yandex'],
];

export default [
  {
    id: 'dns_records', name: 'DNS records', group: 'Infrastructure', source: 'DNS',
    description: 'A, AAAA, CNAME, MX, NS and TXT records, plus SPF and DMARC relationships.',
    inputs: ['domain'],
    async run({ value }, ctx) {
      const types = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'];
      const settled = await Promise.allSettled([...types.map((t) => resolve(value, t, ctx)), resolve(`_dmarc.${value}`, 'TXT', ctx)]);
      if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;
      const [a, aaaa, cname, mx, ns, txt, dmarc] = settled.map((s) => (s.status === 'fulfilled' ? s.value : []));
      const entities = [];
      a.forEach((ip) => entities.push({ type: 'ip', value: ip, rel: 'A record' }));
      aaaa.forEach((ip) => entities.push({ type: 'ip', value: ip, rel: 'AAAA record' }));
      cname.forEach((d) => entities.push({ type: 'domain', value: d, rel: 'CNAME' }));
      ns.forEach((d) => entities.push({ type: 'domain', value: d, rel: 'name server' }));
      for (const d of mx) {
        entities.push({ type: 'domain', value: d, rel: 'mail server' });
        const p = MAIL_PROVIDERS.find(([re]) => re.test(d.toLowerCase()));
        if (p) entities.push({ type: 'technology', value: p[1], rel: 'mail hosted by' });
      }
      for (const rec of txt.filter((t) => /^v=spf1/i.test(t))) {
        for (const tok of rec.split(/\s+/)) {
          const m = tok.match(/^[+?~-]?(include|redirect|ip4|ip6|a|mx)[:=](.+)$/i);
          if (!m) continue;
          const [, mech, arg] = m;
          if (/^ip[46]$/i.test(mech)) entities.push({ type: arg.includes('/') ? 'netblock' : 'ip', value: arg, rel: 'SPF sender' });
          else entities.push({ type: 'domain', value: arg, rel: 'SPF include' });
        }
      }
      for (const rec of dmarc) {
        for (const m of rec.matchAll(/mailto:([^,;\s!]+)/gi)) entities.push({ type: 'email', value: m[1], rel: 'DMARC reports' });
      }
      // domain-verification records reveal which services the organisation has signed up for
      for (const rec of txt) { const t = TXT_SERVICES.find(([re]) => re.test(rec)); if (t) entities.push({ type: 'technology', value: t[1], rel: 'verified with' }); }
      const props = {};
      if (txt.length) props.txt = txt.join('\n').slice(0, 1500);
      if (dmarc.length) props.dmarc = dmarc.join(' ').slice(0, 300);
      return { entities, props };
    },
  },
  {
    id: 'reverse_dns', name: 'Reverse DNS', group: 'Infrastructure', source: 'DNS',
    description: 'PTR record: the host name an IP address points back to.',
    inputs: ['ip'],
    async run({ value }, ctx) {
      const names = await resolve(value, 'PTR', ctx);
      return { entities: names.map((d) => ({ type: 'domain', value: d, rel: 'PTR' })) };
    },
  },
  {
    id: 'decompose', name: 'Break apart', group: 'Local', source: 'local', local: true,
    description: 'Splits a value into the entities it is made of (e-mail → user + domain, URL → host, sub-domain → parent).',
    inputs: ['email', 'url', 'profile', 'domain', 'service', 'photo'],
    async run({ type, value, props }) {
      const entities = [];
      if (type === 'email') {
        const [local, domain] = value.split('@');
        entities.push({ type: 'username', value: local.split('+')[0], rel: 'local part', props: { confidence: 'guess' } });
        entities.push({ type: 'domain', value: domain, rel: 'mail domain' });
      } else if (type === 'domain') {
        const parent = registrableDomain(value);
        if (parent !== value) entities.push({ type: 'domain', value: parent, rel: 'subdomain of' });
      } else if (type === 'service') {
        const host = value.replace(/:\d+(\/\w+)?$/, '');
        entities.push({ type: isIP(host) ? 'ip' : 'domain', value: host, rel: 'on host' });
      } else if (!value.startsWith('upload:')) {
        const host = new URL(value).hostname;
        entities.push({ type: isIP(host) ? 'ip' : 'domain', value: host, rel: 'hosted on' });
        if (type === 'profile' && props?.username) entities.push({ type: 'username', value: props.username, rel: 'handle' });
      }
      return { entities };
    },
  },
];
