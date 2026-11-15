import { registrableDomain } from '../../shared/entities.js';

const REDACTED = /redacted|privacy|not disclosed|withheld|data protected|gdpr|whoisguard|domains by proxy|contact privacy|identity protect/i;

function vcard(entity) {
  const out = {};
  for (const [name, , , val] of entity.vcardArray?.[1] || []) {
    if (name === 'fn' && typeof val === 'string') out.fn = val.trim();
    if (name === 'org') out.org = [].concat(val)[0];
    if (name === 'email' && typeof val === 'string') out.email = val.trim();
    if (name === 'kind') out.kind = val;
    if (name === 'tel' && typeof val === 'string') out.tel = val.replace(/^tel:/, '');
  }
  return out;
}

/** Flatten RDAP entity trees into { roles, fn, org, email } rows. */
function rdapContacts(obj, acc = []) {
  for (const e of obj.entities || []) {
    acc.push({ roles: e.roles || [], handle: e.handle, ...vcard(e) });
    rdapContacts(e, acc);
  }
  return acc;
}

const day = (s) => (s ? String(s).slice(0, 10) : undefined);

export default [
  {
    id: 'rdap_domain', name: 'Domain registration (RDAP/WHOIS)', group: 'Infrastructure', source: 'rdap.org',
    description: 'Registrar, registrant contacts, name servers and registration dates.',
    inputs: ['domain'],
    async run({ value }, ctx) {
      const zone = registrableDomain(value);
      const j = await ctx.http.json(`https://rdap.org/domain/${encodeURIComponent(zone)}`, { okStatuses: [404] });
      if (!j) return { entities: [], notes: [`No RDAP record for ${zone} (the TLD may not support RDAP).`] };
      const entities = [];
      const ev = Object.fromEntries((j.events || []).map((e) => [e.eventAction, e.eventDate]));
      const props = { registered: day(ev.registration), expires: day(ev.expiration), updated: day(ev['last changed']), status: (j.status || []).join(', ') || undefined };
      for (const n of j.nameservers || []) if (n.ldhName) entities.push({ type: 'domain', value: n.ldhName, rel: 'name server' });
      for (const c of rdapContacts(j)) {
        const role = c.roles[0] || 'contact';
        if (c.roles.includes('registrar')) {
          if (c.fn) { entities.push({ type: 'organization', value: c.fn, rel: 'registrar' }); props.registrar = c.fn; }
          continue;
        }
        const name = c.org || c.fn;
        if (name && !REDACTED.test(name)) {
          const isPerson = c.kind === 'individual' && !c.org;
          entities.push({ type: isPerson ? 'person' : 'organization', value: name, rel: role });
        }
        if (c.email && !REDACTED.test(c.email)) entities.push({ type: 'email', value: c.email, rel: `${role} email` });
        if (c.tel && !c.roles.includes('abuse')) entities.push({ type: 'phone', value: c.tel, rel: `${role} phone` });
      }
      if (zone === value) return { entities, props };
      // Registration facts belong to the parent zone: hang them off that node instead.
      const zoneKey = `domain:${zone}`;
      entities.forEach((e) => { e.from = zoneKey; });
      entities.unshift({ type: 'domain', value: zone, rel: 'subdomain of', props });
      return { entities };
    },
  },
  {
    id: 'rdap_ip', name: 'IP allocation (RDAP/WHOIS)', group: 'Infrastructure', source: 'rdap.org',
    description: 'The network block an address belongs to and who it is allocated to.',
    inputs: ['ip', 'netblock'],
    async run({ value }, ctx) {
      const j = await ctx.http.json(`https://rdap.org/ip/${value}`, { okStatuses: [404] });
      if (!j) return { entities: [] };
      const entities = [];
      const blocks = (j.cidr0_cidrs || []).map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`);
      const meta = { name: j.name, handle: j.handle, range: `${j.startAddress} – ${j.endAddress}`, country: j.country };
      blocks.slice(0, 4).forEach((b) => entities.push({ type: 'netblock', value: b, rel: 'part of', label: b, props: meta }));
      if (j.country) entities.push({ type: 'location', value: j.country.toUpperCase(), rel: 'registered in' });
      for (const c of rdapContacts(j)) {
        const name = c.org || c.fn;
        const role = c.roles[0] || 'contact';
        if (name && !REDACTED.test(name) && (c.kind !== 'individual' || c.roles.includes('registrant'))) {
          entities.push({ type: 'organization', value: name, rel: role === 'registrant' ? 'allocated to' : role });
        }
        if (c.email && !REDACTED.test(c.email)) entities.push({ type: 'email', value: c.email, rel: `${role} email` });
      }
      return { entities, props: { network: j.name } };
    },
  },
  {
    id: 'ip_geo', name: 'IP geolocation & ASN', group: 'Infrastructure', source: 'ipwho.is',
    description: 'Approximate location, autonomous system and operator of an IP address.',
    inputs: ['ip'],
    async run({ value }, ctx) {
      const j = await ctx.http.json(`https://ipwho.is/${encodeURIComponent(value)}`);
      if (!j?.success) return { entities: [], notes: [j?.message || 'No geolocation data.'] };
      const entities = [];
      const place = [j.city, j.region, j.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      if (place) entities.push({ type: 'location', value: place, rel: 'located in', props: { lat: j.latitude, lon: j.longitude, precision: 'IP geolocation (approximate)' } });
      const c = j.connection || {};
      if (c.asn) entities.push({ type: 'asn', value: `AS${c.asn}`, rel: 'announced by', label: `AS${c.asn}${c.org ? ` ${c.org}` : ''}`.slice(0, 40), props: { holder: c.org } });
      const op = c.isp || c.org;
      if (op) entities.push({ type: 'organization', value: op, rel: 'operated by' });
      return { entities, props: { country: j.country_code, isp: c.isp } };
    },
  },
  {
    id: 'internetdb', name: 'Open ports & vulnerabilities', group: 'Infrastructure', source: 'Shodan InternetDB',
    description: 'Passive lookup of open ports, host names, software and known CVEs (no scanning is performed).',
    inputs: ['ip'],
    async run({ value }, ctx) {
      const j = await ctx.http.json(`https://internetdb.shodan.io/${encodeURIComponent(value)}`, { okStatuses: [404] });
      if (!j) return { entities: [], notes: ['Shodan has no data for this address.'] };
      const entities = [];
      (j.ports || []).slice(0, 40).forEach((p) => entities.push({ type: 'service', value: `${value}:${p}`, label: `:${p}`, rel: 'open port', props: { port: p } }));
      (j.hostnames || []).slice(0, 30).forEach((h) => entities.push({ type: 'domain', value: h, rel: 'host name' }));
      (j.vulns || []).slice(0, 25).forEach((v) => entities.push({ type: 'vulnerability', value: v, rel: 'may be affected by' }));
      for (const cpe of (j.cpes || []).slice(0, 15)) {
        const [, , vendor, product, version] = cpe.replace('cpe:2.3:', 'cpe:/').split(':');
        if (!product) continue;
        const name = [vendor !== product ? vendor : '', product, version && version !== '*' ? version : ''].filter(Boolean).join(' ').replace(/_/g, ' ');
        entities.push({ type: 'technology', value: name, rel: 'runs', props: { cpe } });
      }
      return { entities, props: { tags: (j.tags || []).join(', ') || undefined } };
    },
  },
  {
    id: 'reverse_ip', name: 'Other sites on this IP', group: 'Infrastructure', source: 'HackerTarget',
    description: 'Domains known to resolve to the same address (shared hosting neighbours). Free tier: a few lookups per day.',
    inputs: ['ip'],
    async run({ value }, ctx) {
      const t = await ctx.http.text(`https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(value)}`);
      if (/^(error|API count exceeded)/i.test(t.trim())) throw new Error(`HackerTarget: ${t.trim().slice(0, 120)}`);
      const hosts = t.split('\n').map((l) => l.trim()).filter((l) => l && !/no dns|no records/i.test(l));
      return {
        entities: hosts.slice(0, 40).map((h) => ({ type: 'domain', value: h, rel: 'resolves here', reverse: true })),
        notes: hosts.length > 40 ? [`${hosts.length} domains found, showing the first 40.`] : [],
      };
    },
  },
  {
    id: 'asn_prefixes', name: 'AS holder & prefixes', group: 'Infrastructure', source: 'RIPEstat',
    description: 'Who operates an autonomous system and which networks it announces.',
    inputs: ['asn'],
    async run({ value }, ctx) {
      const base = 'https://stat.ripe.net/data';
      const [ov, pf] = await Promise.all([
        ctx.http.json(`${base}/as-overview/data.json?resource=${value}`),
        ctx.http.json(`${base}/announced-prefixes/data.json?resource=${value}`),
      ]);
      const entities = [];
      const holder = ov?.data?.holder;
      if (holder) entities.push({ type: 'organization', value: holder.replace(/^\S+ - /, '').replace(/, [A-Z]{2}$/, '') || holder, rel: 'operated by' });
      const prefixes = (pf?.data?.prefixes || []).map((p) => p.prefix);
      prefixes.slice(0, 30).forEach((p) => entities.push({ type: 'netblock', value: p, rel: 'announces' }));
      return { entities, props: { holder, prefixes: prefixes.length }, notes: prefixes.length > 30 ? [`${prefixes.length} prefixes announced, showing 30.`] : [] };
    },
  },
];
