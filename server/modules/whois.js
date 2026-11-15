import net from 'node:net';
import { registrableDomain } from '../../shared/entities.js';

const REDACTED = /redacted|privacy|not disclosed|withheld|data protected|gdpr|whoisguard|domains by proxy|contact privacy|identity protect|select request|statutory masking/i;

function ask(server, query) {
  return new Promise((resolve, reject) => {
    let data = '';
    const sock = net.createConnection({ host: server, port: 43, timeout: 10000 }, () => sock.write(`${query}\r\n`));
    sock.setEncoding('utf8');
    sock.on('data', (d) => { data += d; if (data.length > 200000) sock.destroy(); });
    sock.on('end', () => resolve(data));
    sock.on('close', () => resolve(data));
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`WHOIS server ${server} did not answer`)); });
    sock.on('error', (e) => reject(new Error(`Could not reach WHOIS server ${server} (${e.code || e.message})`)));
  });
}

/** Parse a WHOIS answer (registry "key: value" styles incl. contact blocks as used by .at/.de/.eu and the gTLD format). */
export function parseWhois(text, domain) {
  const entities = [];
  const props = {};
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.match(/^\s*([A-Za-z][\w .\/-]{1,40}?)\s*:\s*(.+?)\s*$/)).filter(Boolean).map((m) => [m[1].toLowerCase().trim(), m[2]])).filter((b) => b.length);
  const all = blocks.flat();
  const first = (re) => all.find(([k, v]) => re.test(k) && !REDACTED.test(v))?.[1];
  const day = (v) => v?.match(/\d{4}-?\d{2}-?\d{2}/)?.[0]?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') || v;
  props.registered = day(first(/^(creation date|created|registered on|registration time|registered)$/));
  props.updated = day(first(/^(updated date|changed|last[- ]modified|last updated|modified)$/));
  props.expires = day(first(/expir|paid-till|renewal date/));
  props.registrar = first(/^(registrar|registrar name|sponsoring registrar)$/);
  if (props.registrar) entities.push({ type: 'organization', value: props.registrar.replace(/\s*\(\s*https?:[^)]*\)/, ''), rel: 'registrar' });
  for (const [k, v] of all) if (/^(nserver|name server|nameserver|nameservers)$/.test(k)) entities.push({ type: 'domain', value: v.split(/\s+/)[0], rel: 'name server' });

  // roles → contact handles (registry style): "registrant: ABC123", "tech-c: XYZ"
  const roleOf = new Map();
  for (const [k, v] of blocks[0] || []) {
    const role = { registrant: 'registrant', holder: 'registrant', 'admin-c': 'administrative contact', 'tech-c': 'technical contact', 'zone-c': 'zone contact', 'billing-c': 'billing contact' }[k];
    if (role && !roleOf.has(v)) roleOf.set(v, role);
  }
  const contact = (fields, role) => {
    const get = (re) => fields.find(([k, v]) => re.test(k) && !REDACTED.test(v))?.[1];
    const org = get(/^(organization|organisation|org|org-name|registrant organization|company)$/);
    const person = get(/^(personname|person|name|registrant name|registrant)$/);
    const ckey = org ? `organization:${org}` : person ? `person:${person}` : null;
    if (org) entities.push({ type: 'organization', value: org, rel: role });
    if (person && /\s/.test(person) && person !== org) entities.push({ type: 'person', value: person, rel: role, from: org ? `organization:${org}` : undefined });
    for (const [k, v] of fields) {
      if (REDACTED.test(v)) continue;
      if (/e-?mail/.test(k) && /@/.test(v)) entities.push({ type: 'email', value: v, rel: `${role} email`, from: ckey || undefined });
      else if (/^(phone|tel|telephone|registrant phone)$/.test(k)) entities.push({ type: 'phone', value: v, rel: `${role} phone`, from: ckey || undefined });
    }
    const addr = [get(/^(street address|street|address|registrant street)$/), [get(/^(postal code|postalcode|pcode|registrant postal code)$/), get(/^(city|registrant city)$/)].filter(Boolean).join(' '), get(/^(country|registrant country)$/)].filter(Boolean).join(', ');
    if (addr && (org || person)) entities.push({ type: 'location', value: addr, rel: 'address', from: ckey });
  };
  for (const b of blocks.slice(1)) {
    const hdl = b.find(([k]) => /^(nic-hdl|handle|contact)$/.test(k))?.[1];
    if (hdl && roleOf.has(hdl)) contact(b, roleOf.get(hdl));
    else if (hdl && b.some(([k]) => /personname|organization|e-mail/.test(k))) contact(b, 'contact');
  }
  // gTLD style: "Registrant Organization: ...", "Registrant Email: ..." in one block
  for (const role of ['registrant', 'admin', 'tech']) {
    const fields = all.filter(([k]) => k.startsWith(`${role} `)).map(([k, v]) => [k.replace(`${role} `, 'registrant '), v]);
    if (fields.length) contact(fields, { registrant: 'registrant', admin: 'administrative contact', tech: 'technical contact' }[role]);
  }
  const abuse = first(/abuse contact email/);
  if (abuse) entities.push({ type: 'email', value: abuse, rel: 'registrar abuse email' });
  props.whois = text.split('\n').filter((l) => l.trim() && !/^[%#>]/.test(l.trim())).slice(0, 60).join('\n').slice(0, 1800);
  return { entities, props, domain };
}

export default {
  id: 'whois', name: 'WHOIS record', group: 'Infrastructure', source: 'registry WHOIS (port 43)',
  description: 'Classic WHOIS straight from the registry: holder, contacts, address, name servers and dates. Works for country domains (.at, .de, .eu ...) that RDAP often does not cover.',
  inputs: ['domain'],
  async run({ value }) {
    const zone = registrableDomain(value);
    const tld = zone.split('.').pop();
    const iana = await ask('whois.iana.org', tld);
    const server = iana.match(/^\s*(?:refer|whois):\s*(\S+)/im)?.[1];
    if (!server) return { entities: [], notes: [`No WHOIS server is published for .${tld}.`] };
    let text = await ask(server, zone);
    const thin = text.match(/Registrar WHOIS Server:\s*(\S+)/i)?.[1]?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (thin && thin !== server) { try { const more = await ask(thin, zone); if (more.length > 200) text = `${more}\n\n${text}`; } catch { /* keep the registry answer */ } }
    if (/no match|not found|no entries found|nothing found|no data found/i.test(text.slice(0, 400)) && text.length < 800) return { entities: [], notes: [`${zone} is not registered (according to ${server}).`] };
    const r = parseWhois(text, zone);
    if (zone === value) return { entities: r.entities, props: r.props, notes: [`Answered by ${server}.`] };
    const zk = `domain:${zone}`;
    r.entities.forEach((e) => { e.from ||= zk; });
    return { entities: [{ type: 'domain', value: zone, rel: 'subdomain of', props: r.props }, ...r.entities], notes: [`Answered by ${server}.`] };
  },
};
