const WD = 'https://www.wikidata.org/w/api.php';
const commons = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=400`;

// Wikidata property → how it shows up in the graph. `item` values are other Wikidata entities.
const CLAIMS = {
  P19: { type: 'location', rel: 'born in', item: true }, P551: { type: 'location', rel: 'lives in', item: true },
  P27: { type: 'location', rel: 'citizen of', item: true }, P159: { type: 'location', rel: 'headquartered in', item: true },
  P108: { type: 'organization', rel: 'works at', item: true }, P69: { type: 'organization', rel: 'educated at', item: true },
  P463: { type: 'organization', rel: 'member of', item: true }, P102: { type: 'organization', rel: 'member of party', item: true },
  P127: { type: 'organization', rel: 'owned by', item: true }, P749: { type: 'organization', rel: 'parent organisation', item: true },
  P355: { type: 'organization', rel: 'subsidiary', item: true },
  P26: { type: 'person', rel: 'spouse', item: true }, P40: { type: 'person', rel: 'child', item: true },
  P22: { type: 'person', rel: 'father', item: true }, P25: { type: 'person', rel: 'mother', item: true },
  P3373: { type: 'person', rel: 'sibling', item: true }, P451: { type: 'person', rel: 'partner', item: true },
  P169: { type: 'person', rel: 'chief executive', item: true }, P112: { type: 'person', rel: 'founded by', item: true },
  P488: { type: 'person', rel: 'chairperson', item: true },
  P856: { type: 'url', rel: 'official website' },
  P18: { type: 'photo', rel: 'image', map: commons }, P154: { type: 'photo', rel: 'logo', map: commons },
  P2002: { type: 'profile', rel: 'has account', site: 'X', map: (u) => `https://x.com/${u}` },
  P2037: { type: 'profile', rel: 'has account', site: 'GitHub', map: (u) => `https://github.com/${u}` },
  P2003: { type: 'profile', rel: 'has account', site: 'Instagram', map: (u) => `https://www.instagram.com/${u}` },
  P2013: { type: 'profile', rel: 'has account', site: 'Facebook', map: (u) => `https://www.facebook.com/${u}` },
  P6634: { type: 'profile', rel: 'has account', site: 'LinkedIn', map: (u) => `https://www.linkedin.com/in/${u}` },
};

const claimValues = (claims, pid) => (claims[pid] || []).filter((c) => c.rank !== 'deprecated').map((c) => c.mainsnak?.datavalue?.value).filter((v) => v != null);

export default [
  {
    id: 'wikidata', name: 'Wikidata knowledge graph', group: 'People', source: 'Wikidata',
    description: 'For notable people and organisations: relatives, employers, memberships, places, official accounts and photo.',
    inputs: ['person', 'organization'],
    async run({ value }, ctx) {
      const s = await ctx.http.json(`${WD}?action=wbsearchentities&format=json&language=en&uselang=en&limit=5&search=${encodeURIComponent(value)}`);
      const hits = s?.search || [];
      if (!hits.length) return { entities: [], notes: ['No Wikidata entry with this name.'] };
      const top = hits[0];
      const e = (await ctx.http.json(`${WD}?action=wbgetentities&format=json&props=claims|sitelinks&sitefilter=enwiki&ids=${top.id}`, { maxBytes: 6_000_000 }))?.entities?.[top.id];
      const claims = e?.claims || {};
      const pending = [];
      const ids = new Set();
      for (const [pid, def] of Object.entries(CLAIMS)) {
        for (const v of claimValues(claims, pid).slice(0, 6)) {
          if (def.item) { if (v.id) { ids.add(v.id); pending.push({ def, id: v.id }); } }
          else if (typeof v === 'string') pending.push({ def, value: def.map ? def.map(v) : v, raw: v });
        }
      }
      const occupationIds = claimValues(claims, 'P106').slice(0, 4).map((v) => v.id).filter(Boolean);
      occupationIds.forEach((id) => ids.add(id));
      let labels = {};
      if (ids.size) {
        const l = await ctx.http.json(`${WD}?action=wbgetentities&format=json&props=labels&languages=en&ids=${[...ids].slice(0, 50).join('|')}`);
        labels = Object.fromEntries(Object.entries(l?.entities || {}).map(([id, v]) => [id, v.labels?.en?.value]));
      }
      const entities = [];
      for (const p of pending) {
        if (p.id) { if (labels[p.id]) entities.push({ type: p.def.type, value: labels[p.id], rel: p.def.rel, props: { wikidata: `https://www.wikidata.org/wiki/${p.id}` } }); }
        else if (p.def.type === 'profile') entities.push({ type: 'profile', value: p.value, label: `${p.def.site}: ${p.raw}`, rel: p.def.rel, props: { site: p.def.site, username: p.raw } });
        else entities.push({ type: p.def.type, value: p.value, rel: p.def.rel });
      }
      const time = (pid) => claimValues(claims, pid)[0]?.time?.match(/^\+?(\d{4}-\d{2}-\d{2})/)?.[1]?.replace(/-00/g, '');
      const props = {
        description: top.description, wikidata: `https://www.wikidata.org/wiki/${top.id}`,
        wikipedia: e?.sitelinks?.enwiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(e.sitelinks.enwiki.title.replace(/ /g, '_'))}` : undefined,
        born: time('P569'), died: time('P570'), founded: time('P571'),
        occupation: occupationIds.map((id) => labels[id]).filter(Boolean).join(', ') || undefined,
      };
      const notes = [`Matched "${top.label}"${top.description ? ` (${top.description})` : ''}.`];
      if (hits.length > 1) notes.push(`Other entries with this name: ${hits.slice(1).map((h) => `${h.label}${h.description ? ` – ${h.description}` : ''}`).join('; ')}. Check it is the right one.`);
      return { entities, props, notes };
    },
  },
  {
    id: 'openalex', name: 'Academic affiliations & co-authors', group: 'People', source: 'OpenAlex', auto: false,
    description: 'Research institutions and most frequent co-authors of a published author.',
    inputs: ['person'],
    async run({ value }, ctx) {
      const a = (await ctx.http.json(`https://api.openalex.org/authors?per-page=3&search=${encodeURIComponent(value)}`))?.results || [];
      if (!a.length) return { entities: [], notes: ['No author with this name in OpenAlex.'] };
      const top = a[0];
      const entities = [];
      for (const i of top.last_known_institutions || []) entities.push({ type: 'organization', value: i.display_name, rel: 'affiliated with', props: { country: i.country_code } });
      if (top.orcid) entities.push({ type: 'profile', value: top.orcid, label: `ORCID: ${top.orcid.split('/').pop()}`, rel: 'has account', props: { site: 'ORCID' } });
      const id = top.id.split('/').pop();
      const w = (await ctx.http.json(`https://api.openalex.org/works?per-page=40&sort=cited_by_count:desc&select=authorships&filter=author.id:${id}`, { maxBytes: 4_000_000 }))?.results || [];
      const co = new Map();
      for (const work of w) {
        if ((work.authorships || []).length > 15) continue; // huge consortium papers say little about who works with whom
        for (const au of work.authorships || []) {
          const n = au.author?.display_name;
          if (n && au.author.id !== top.id) co.set(n, (co.get(n) || 0) + 1);
        }
      }
      [...co.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).forEach(([n, c]) => entities.push({ type: 'person', value: n, rel: 'co-author', props: { shared_papers: c } }));
      const notes = [`Matched author "${top.display_name}" (${top.works_count} works).`];
      if (a.length > 1) notes.push('Several authors share this name; verify the match.');
      return { entities, props: { openalex: top.id, works: top.works_count, citations: top.cited_by_count }, notes };
    },
  },
  {
    id: 'geocode', name: 'Geocode place', group: 'People', source: 'OpenStreetMap',
    description: 'Coordinates and country of a place name or address.',
    inputs: ['location'],
    async run({ value, props }, ctx) {
      if (props?.lat != null && props?.lon != null && /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value)) {
        const j = await ctx.http.json(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${props.lat}&lon=${props.lon}`, { headers: { 'accept-language': 'en' } });
        if (!j?.display_name) return { entities: [] };
        return { entities: [{ type: 'location', value: [j.address?.city || j.address?.town || j.address?.village || j.address?.county, j.address?.country].filter(Boolean).join(', ') || j.display_name, rel: 'in' }], props: { address: j.display_name } };
      }
      const j = (await ctx.http.json(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(value)}`, { headers: { 'accept-language': 'en' } }))?.[0];
      if (!j) return { entities: [], notes: ['Place not found.'] };
      const entities = [];
      const country = j.address?.country;
      if (country && country.toLowerCase() !== value.toLowerCase()) entities.push({ type: 'location', value: country, rel: 'in country' });
      return { entities, props: { lat: +j.lat, lon: +j.lon, address: j.display_name, place_type: j.type } };
    },
  },
];
