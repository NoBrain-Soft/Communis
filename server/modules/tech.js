const NVD = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

function summary(c) {
  const m = c.metrics || {};
  const cvss = (m.cvssMetricV31 || m.cvssMetricV40 || m.cvssMetricV30 || m.cvssMetricV2 || [])[0];
  return {
    summary: (c.descriptions || []).find((d) => d.lang === 'en')?.value?.slice(0, 400),
    cvss: cvss?.cvssData?.baseScore, severity: cvss?.cvssData?.baseSeverity || cvss?.baseSeverity,
    published: c.published?.slice(0, 10),
  };
}

export default [
  {
    id: 'tech_cves', name: 'Known vulnerabilities', group: 'Infrastructure', source: 'NVD', auto: false,
    description: 'CVEs published for this software. Most useful when the version is part of the name (e.g. "nginx 1.18.0").',
    inputs: ['technology'],
    async run({ value, props }, ctx) {
      // InternetDB gives a CPE; that matches a product and version exactly, a keyword search is only a fallback
      const cpe = props?.cpe && String(props.cpe).replace(/^cpe:\//, '').split(':');
      const q = cpe && cpe.length >= 3
        ? `virtualMatchString=${encodeURIComponent(`cpe:2.3:${cpe[0]}:${cpe[1]}:${cpe[2]}:${cpe[3] || '*'}`)}`
        : `keywordSearch=${encodeURIComponent(value.replace(/^WordPress plugin: /, ''))}`;
      const head = await ctx.http.json(`${NVD}?${q}&resultsPerPage=1`, { timeout: 30000 });
      const total = head?.totalResults || 0;
      if (!total) return { entities: [], notes: ['No CVE entries match this name.'] };
      const page = total > 1 ? await ctx.http.json(`${NVD}?${q}&resultsPerPage=15&startIndex=${Math.max(0, total - 15)}`, { timeout: 30000, maxBytes: 6_000_000 }) : head;
      const list = (page?.vulnerabilities || []).map((v) => v.cve).filter((c) => c?.id && c.vulnStatus !== 'Rejected').reverse();
      return {
        entities: list.map((c) => ({ type: 'vulnerability', value: c.id, rel: cpe ? 'affected by' : 'possibly affected by', props: summary(c) })),
        props: { cves_total: total },
        notes: [total > 15 ? `${total} CVEs match; showing the 15 most recent.` : '', cpe ? '' : 'Matched by keyword: check that each CVE really applies to this version.'].filter(Boolean),
      };
    },
  },
  {
    id: 'cve_details', name: 'Vulnerability details', group: 'Infrastructure', source: 'NVD',
    description: 'Description, severity score, affected products and references of a CVE.',
    inputs: ['vulnerability'],
    async run({ value }, ctx) {
      const c = (await ctx.http.json(`${NVD}?cveId=${encodeURIComponent(value)}`, { timeout: 30000, maxBytes: 4_000_000 }))?.vulnerabilities?.[0]?.cve;
      if (!c) return { entities: [], notes: ['Not found in the NVD.'] };
      const products = new Set();
      for (const conf of c.configurations || []) for (const n of conf.nodes || []) for (const m of n.cpeMatch || []) {
        const [, , , vendor, product] = String(m.criteria).split(':');
        if (m.vulnerable && product) products.add([vendor !== product ? vendor : '', product].filter(Boolean).join(' ').replace(/_/g, ' '));
      }
      const refs = (c.references || []).map((r) => r.url).slice(0, 3);
      return {
        entities: [...[...products].slice(0, 6).map((p) => ({ type: 'technology', value: p, rel: 'affects' })), ...refs.map((u) => ({ type: 'url', value: u, rel: 'reference' }))],
        props: summary(c),
      };
    },
  },
];
