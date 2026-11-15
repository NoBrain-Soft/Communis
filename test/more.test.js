import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWhois } from '../server/modules/whois.js';
import { detectFaces } from '../server/lib/faces.js';
import { googleNews } from '../server/lib/search.js';
import { loadModules, runModule } from '../server/index.js';

const mods = await loadModules();

test('WHOIS: registry contact blocks (.at style)', () => {
  const r = parseWhois(`% Copyright (c) nic.at
domain:         nordwind-pharma.at
registrar:      Example Registrar GmbH ( https://nic.at/registrar/1 )
registrant:     NPG123456-NICAT
tech-c:         EH987-NICAT
nserver:        ns1.hosting.example
nserver:        ns2.hosting.example
changed:        20240105 10:11:12
source:         AT-DOM

personname:     Roland Huemer
organization:   Nordwind Pharma GmbH
street address: Feldgasse 19
postal code:    4600
city:           Wels
country:        Austria
phone:          +437242490
e-mail:         office@nordwind-pharma.at
nic-hdl:        NPG123456-NICAT
changed:        20200101 08:00:00

personname:     <data not disclosed>
organization:   Example Hosting
e-mail:         hostmaster@hosting.example
nic-hdl:        EH987-NICAT
`, 'nordwind-pharma.at');
  const got = r.entities.map((e) => `${e.type}:${e.value}|${e.rel}`);
  for (const want of ['organization:Example Registrar GmbH|registrar', 'domain:ns1.hosting.example|name server', 'organization:Nordwind Pharma GmbH|registrant', 'person:Roland Huemer|registrant',
    'email:office@nordwind-pharma.at|registrant email', 'phone:+437242490|registrant phone', 'location:Feldgasse 19, 4600 Wels, Austria|address', 'organization:Example Hosting|technical contact', 'email:hostmaster@hosting.example|technical contact email'])
    assert.ok(got.includes(want), `${want}\n in ${got.join('\n')}`);
  assert.ok(!got.some((g) => /not disclosed/.test(g)));
  assert.equal(r.props.updated, '2024-01-05');
});

test('WHOIS: gTLD style', () => {
  const r = parseWhois(`Domain Name: example.com
Registrar: Example Registrar, Inc.
Creation Date: 1995-08-14T04:00:00Z
Registry Expiry Date: 2026-08-13T04:00:00Z
Registrant Organization: Acme Holdings
Registrant Name: REDACTED FOR PRIVACY
Registrant Email: Please query the RDDS service
Registrant Country: US
Name Server: A.IANA-SERVERS.NET
Registrar Abuse Contact Email: abuse@registrar.test`, 'example.com');
  const got = r.entities.map((e) => `${e.type}:${e.value}|${e.rel}`);
  for (const want of ['organization:Example Registrar, Inc.|registrar', 'organization:Acme Holdings|registrant', 'domain:A.IANA-SERVERS.NET|name server', 'email:abuse@registrar.test|registrar abuse email'])
    assert.ok(got.includes(want), `${want} in ${got}`);
  assert.equal(r.props.registered, '1995-08-14');
  assert.equal(r.props.expires, '2026-08-13');
  assert.ok(!got.some((g) => /REDACTED|RDDS/.test(g)));
});

test('face detection finds a face in a portrait and none in a drawing', async () => {
  const buf = readFileSync(new URL('./fixtures/portrait.png', import.meta.url));
  const { faces, img } = detectFaces(buf, 'image/png');
  assert.equal(faces.length, 1);
  const f = faces[0];
  assert.ok(f.x > 60 && f.x < 130 && f.y > 10 && f.y < 70, JSON.stringify(f));
  assert.equal(img.width, 256);
});

test('news search: Google News items plus the configured news sites', async () => {
  const rss = `<rss><channel><item><title>Jane Doe wins award - Regional Daily</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Tue, 03 Nov 2026 08:00:00 GMT</pubDate><source url="https://regionaldaily.test">Regional Daily</source></item>
    <item><title><![CDATA[Interview: Jane Doe &amp; friends - Other Paper]]></title><link>https://news.google.com/rss/articles/def</link><pubDate>bad</pubDate><source url="https://other.test">Other Paper</source></item></channel></rss>`;
  const urls = [];
  const http = { async text(url) {
    urls.push(decodeURIComponent(url));
    if (url.includes('news.google.com')) return rss;
    return `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://www.tips.at/nachrichten/wels/123-jane-doe')}">Jane Doe eröffnet Standort</a><a class="result__a" href="https://unrelated.test/x">noise</a>`;
  } };
  assert.equal((await googleNews('"x"', 'AT:de', { http }))[0].published, '2026-11-03');
  const r = await runModule(mods.get('news_search'), { type: 'person', value: 'Jane Doe' }, { newsSites: 'tips.at, https://www.nachrichten.at/', newsRegion: 'AT:de' }, http);
  assert.ok(urls.some((u) => u.includes('gl=AT') && u.includes('hl=de')));
  assert.ok(urls.some((u) => u.includes('(site:tips.at OR site:nachrichten.at)')));
  assert.deepEqual(r.entities.map((e) => [e.label, e.props.source]), [['Jane Doe wins award', 'Regional Daily'], ['Interview: Jane Doe & friends', 'Other Paper'], ['Jane Doe eröffnet Standort', 'tips.at']]);
});

test('scraping a page links it to names already in the graph', async () => {
  const http = { async raw(url) { return { status: 200, url, headers: new Headers({ 'content-type': 'text/html' }), buf: Buffer.from('<html><body><p>Am Montag sprach Roland  Huemer von Nordwind Pharma.</p><script src="/js/jquery-3.6.0.min.js"></script></body></html>') }; } };
  const r = await runModule(mods.get('web_scrape'), { type: 'url', value: 'https://paper.test/a', context: { known: [{ type: 'person', value: 'Roland Huemer' }, { type: 'organization', value: 'Nordwind Pharma' }, { type: 'person', value: 'Someone Else' }, { type: 'email', value: 'x@y.test' }] } }, {}, http);
  assert.deepEqual(r.entities.map((e) => e.key).sort(), ['organization:nordwind pharma', 'person:roland huemer', 'technology:jquery 3.6.0']);
});

test('CVE lookup for a technology', async () => {
  const cve = (id) => ({ cve: { id, published: '2021-05-25T00:00:00', descriptions: [{ lang: 'en', value: 'Off-by-one in resolver' }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.7, baseSeverity: 'HIGH' } }] },
    configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:f5:nginx:*:*:*:*:*:*:*:*' }] }] }], references: [{ url: 'https://nginx.test/advisory' }] } });
  const calls = [];
  const http = { async json(url) { calls.push(url); return url.includes('resultsPerPage=1&') || url.endsWith('resultsPerPage=1') ? { totalResults: 2, vulnerabilities: [cve('CVE-2021-0001')] } : { totalResults: 2, vulnerabilities: [cve('CVE-2021-0001'), cve('CVE-2021-23017')] }; } };
  const r = await runModule(mods.get('tech_cves'), { type: 'technology', value: 'f5 nginx 1.18.0', props: { cpe: 'cpe:/a:f5:nginx:1.18.0' } }, {}, http);
  assert.ok(calls[0].includes(encodeURIComponent('cpe:2.3:a:f5:nginx:1.18.0')));
  assert.deepEqual(r.entities.map((e) => e.value), ['CVE-2021-23017', 'CVE-2021-0001']);
  assert.equal(r.entities[0].props.severity, 'HIGH');
  const d = await runModule(mods.get('cve_details'), { type: 'vulnerability', value: 'CVE-2021-23017' }, {}, { async json() { return { vulnerabilities: [cve('CVE-2021-23017')] }; } });
  assert.deepEqual(d.entities.map((e) => e.key), ['technology:f5 nginx', 'url:https://nginx.test/advisory']);
  assert.equal(d.props.cvss, 7.7);
});
