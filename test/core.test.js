import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { normalize, keyOf, detectType, registrableDomain } from '../shared/entities.js';
import { extractFromText, extractFromHtml, socialProfile } from '../server/lib/extract.js';
import { readExif, fingerprint, sniff } from '../server/lib/images.js';
import { loadModules, runModule, finalize } from '../server/index.js';

const mods = await loadModules();
/** Fake HTTP layer: routes is a list of [url substring, reply]. A reply of null means 404. */
function fake(routes) {
  const find = (url) => { const r = routes.find(([k]) => url.includes(k)); if (!r) throw new Error(`unexpected request ${url}`); return r[1]; };
  return {
    async json(url) { return find(url); },
    async text(url) { return find(url); },
    async raw(url) { const v = find(url); return v && v.buf ? v : { status: v == null ? 404 : 200, url, headers: new Headers(v?.headers || {}), buf: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v ?? '')) }; },
  };
}
const run = (id, type, value, routes = [], props) => runModule(mods.get(id), { type, value, props }, {}, fake(routes));
const keys = (r) => r.entities.map((e) => e.key);

test('normalisation and identity', () => {
  assert.equal(normalize('domain', 'HTTPS://WWW.Example.com/path'), 'www.example.com');
  assert.equal(normalize('domain', '*.example.com.'), 'example.com');
  assert.equal(normalize('domain', 'not a domain'), '');
  assert.equal(normalize('email', ' Bob@Example.COM '), 'bob@example.com');
  assert.equal(normalize('asn', 'as15169'), 'AS15169');
  assert.equal(normalize('phone', '+44 (20) 7946-0958'), '+442079460958');
  assert.equal(keyOf('person', 'Ada  Lovelace'), keyOf('person', 'ada lovelace'));
  assert.equal(normalize('url', 'javascript:alert(1)'), '');
  assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
});

test('type detection', () => {
  const cases = { 'a@b.io': 'email', '8.8.8.8': 'ip', '2001:db8::1': 'ip', '10.0.0.0/8': 'netblock', AS64500: 'asn', 'example.com': 'domain',
    'https://example.com/x': 'url', 'https://example.com/a.jpg': 'photo', '@neo': 'username', 'Ada Lovelace': 'person', '+31 20 555 0142': 'phone',
    'CVE-2021-44228': 'vulnerability', torvalds: 'username', 'some longer phrase here': 'phrase' };
  for (const [input, type] of Object.entries(cases)) assert.equal(detectType(input), type, input);
});

test('text extraction', () => {
  const r = extractFromText('Contact bob@corp.example.com or +1 (415) 555-0100. Server 203.0.113.9 (mail.corp.example.com) see https://github.com/bobdev and https://corp.example.com/report.pdf, CVE-2024-3094.');
  const got = r.map((e) => `${e.type}:${e.value}`);
  for (const want of ['email:bob@corp.example.com', 'ip:203.0.113.9', 'domain:mail.corp.example.com', 'profile:https://github.com/bobdev', 'url:https://corp.example.com/report.pdf', 'vulnerability:CVE-2024-3094'])
    assert.ok(got.includes(want), `${want} in ${got}`);
  assert.ok(got.some((g) => g.startsWith('phone:+1')));
  assert.ok(!got.includes('domain:corp.example.com'), 'e-mail and URL hosts are not repeated as bare domains');
});

test('social profile recognition', () => {
  assert.deepEqual(socialProfile('https://twitter.com/jack'), { site: 'X', username: 'jack', url: 'https://x.com/jack' });
  assert.equal(socialProfile('https://twitter.com/share?x=1'), null);
  assert.equal(socialProfile('https://github.com/a/b'), null);
  assert.equal(socialProfile('https://infosec.exchange/@someone').site, 'Mastodon');
});

test('html extraction', () => {
  const html = `<html><head><title>Acme &amp; Co</title><meta name="author" content="Jane Roe"><meta property="og:image" content="/img/a.png">
    <meta name="generator" content="WordPress 6.4"><script type="application/ld+json">{"@type":"Organization","name":"Acme Corp","sameAs":["https://www.linkedin.com/company/acme"]}</script></head>
    <body><a href="mailto:Sales@acme.test?subject=x">mail</a><a href="tel:+15550100">call</a><a href="https://x.com/acme">x</a><a href="https://partner.example.org/p">p</a>
    <a href="/local">l</a> write to info@acme.test <script>var x="tracker@evil.test"</script></body></html>`;
  const x = extractFromHtml(html, 'https://www.acme.test/');
  assert.equal(x.title, 'Acme & Co');
  assert.deepEqual(x.emails.sort(), ['info@acme.test', 'sales@acme.test']);
  assert.deepEqual(x.phones, ['+15550100']);
  assert.deepEqual(x.people, ['Jane Roe']);
  assert.deepEqual(x.orgs, ['Acme Corp']);
  assert.deepEqual(x.images, ['https://www.acme.test/img/a.png']);
  assert.deepEqual(x.externalDomains, ['partner.example.org']);
  assert.deepEqual(x.profiles.map((p) => p.site).sort(), ['LinkedIn', 'X']);
});

test('finalize drops invalid values, self references and merges duplicates', () => {
  const r = finalize({ type: 'domain', value: 'example.com' }, { entities: [
    { type: 'ip', value: 'nope', rel: 'A' }, { type: 'domain', value: 'EXAMPLE.com', rel: 'self' },
    { type: 'ip', value: '192.0.2.1', rel: 'A record' }, { type: 'ip', value: '192.0.2.1', rel: 'SPF sender', props: { x: 1 } },
    { type: 'domain', value: 'a.example.com', rel: 'valid for', from: 'ip:192.0.2.1' } ] });
  assert.deepEqual(keys(r), ['ip:192.0.2.1', 'domain:a.example.com']);
  assert.deepEqual(r.entities[0].edges.map((e) => e.rel), ['A record', 'SPF sender']);
  assert.equal(r.entities[1].edges[0].from, 'ip:192.0.2.1');
});

test('crt.sh subdomains', async () => {
  const r = await run('crtsh', 'domain', 'example.com', [['crt.sh', [{ name_value: '*.example.com\nwww.example.com' }, { name_value: 'dev.api.example.com' }, { name_value: 'other.org' }, { name_value: 'admin@example.com' }]]]);
  assert.deepEqual(keys(r), ['domain:www.example.com', 'domain:dev.api.example.com']);
  assert.ok(r.entities[0].edges[0].reverse);
});

test('RDAP domain: contacts hang off the registered zone, privacy placeholders are skipped', async () => {
  const rdap = { events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }], nameservers: [{ ldhName: 'A.IANA-SERVERS.NET' }], entities: [
    { roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]], entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@registrar.test']]] }] },
    { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'REDACTED FOR PRIVACY'], ['org', {}, 'text', 'Acme Holdings']]] }] };
  const r = await run('rdap_domain', 'domain', 'www.example.com', [['rdap.org/domain/example.com', rdap]]);
  assert.deepEqual(keys(r), ['domain:example.com', 'domain:a.iana-servers.net', 'organization:example registrar', 'email:abuse@registrar.test', 'organization:acme holdings']);
  assert.equal(r.entities[0].props.registered, '1995-08-14');
  assert.equal(r.entities[2].edges[0].from, 'domain:example.com');
});

test('InternetDB ports, CVEs and software', async () => {
  const r = await run('internetdb', 'ip', '192.0.2.5', [['internetdb', { ports: [22, 443], hostnames: ['h.example.net'], vulns: ['CVE-2023-0001'], cpes: ['cpe:/a:openbsd:openssh:8.2'], tags: ['cloud'] }]]);
  assert.deepEqual(keys(r), ['service:192.0.2.5:22', 'service:192.0.2.5:443', 'domain:h.example.net', 'vulnerability:CVE-2023-0001'.toLowerCase(), 'technology:openbsd openssh 8.2']);
  assert.equal((await run('internetdb', 'ip', '192.0.2.6', [['internetdb', null]])).entities.length, 0);
});

test('username hunt builds profile sub-graphs and survives failing sites', async () => {
  const r = await run('username_hunt', 'username', 'Neo', [
    ['api.github.com/users/neo', { html_url: 'https://github.com/neo', name: 'Thomas Anderson', avatar_url: 'https://avatars.example/1.png', location: 'Zion', company: '@metacortex', email: 'neo@metacortex.test', blog: 'neo.example', twitter_username: 'the_one' }],
    ['hacker-news', { id: 'neo', karma: 5, created: 1300000000 }],
    ['keybase', { them: [null] }], ['gitlab', []], ['npmjs', { total: 0 }],
  ]);
  const k = keys(r);
  for (const want of ['profile:https://github.com/neo', 'person:thomas anderson', 'photo:https://avatars.example/1.png', 'location:zion', 'organization:metacortex', 'email:neo@metacortex.test', 'url:https://neo.example/', 'profile:https://x.com/the_one', 'profile:https://news.ycombinator.com/user?id=neo'])
    assert.ok(k.includes(want), `${want} in ${k}`);
  assert.equal(r.entities.find((e) => e.key === 'person:thomas anderson').edges[0].from, 'profile:https://github.com/neo');
  assert.match(r.notes[0], /Could not check/);
});

test('wikidata relations', async () => {
  const r = await run('wikidata', 'person', 'Ada Lovelace', [
    ['wbsearchentities', { search: [{ id: 'Q7259', label: 'Ada Lovelace', description: 'English mathematician' }] }],
    ['props=claims', { entities: { Q7259: { sitelinks: { enwiki: { title: 'Ada Lovelace' } }, claims: {
      P19: [{ mainsnak: { datavalue: { value: { id: 'Q84' } } } }], P22: [{ mainsnak: { datavalue: { value: { id: 'Q5679' } } } }],
      P18: [{ mainsnak: { datavalue: { value: 'Ada Lovelace portrait.jpg' } } }], P569: [{ mainsnak: { datavalue: { value: { time: '+1815-12-10T00:00:00Z' } } } }] } } } }],
    ['props=labels', { entities: { Q84: { labels: { en: { value: 'London' } } }, Q5679: { labels: { en: { value: 'Lord Byron' } } } } }],
  ]);
  assert.deepEqual(keys(r).sort(), ['location:london', 'person:lord byron', 'photo:https://commons.wikimedia.org/wiki/special:filepath/ada_lovelace_portrait.jpg?width=400']);
  assert.equal(r.props.born, '1815-12-10');
  assert.equal(r.props.wikipedia, 'https://en.wikipedia.org/wiki/Ada_Lovelace');
});

test('web scrape of a domain', async () => {
  const page = { status: 200, url: 'https://www.acme.test/', headers: new Headers({ server: 'nginx/1.24.0', 'cf-ray': 'x', 'content-type': 'text/html' }), buf: Buffer.from('<title>Acme</title><link href="/wp-content/a.css"><a href="mailto:hi@acme.test">m</a>') };
  const r = await run('web_scrape', 'domain', 'acme.test', [['acme.test', page]]);
  assert.deepEqual(keys(r).sort(), ['email:hi@acme.test', 'technology:cloudflare', 'technology:nginx/1.24.0', 'technology:wordpress', 'url:https://www.acme.test/']);
  assert.equal(r.props.title, 'Acme');
});

// ---- images: build a JPEG with GPS EXIF by hand, and PNGs for the perceptual hash ----
function exifJpeg() {
  const tiff = Buffer.alloc(200);
  tiff.write('MM\0*', 0, 'latin1'); tiff.writeUInt32BE(8, 4);
  const entry = (o, tag, type, count, val) => { tiff.writeUInt16BE(tag, o); tiff.writeUInt16BE(type, o + 2); tiff.writeUInt32BE(count, o + 4); tiff.writeUInt32BE(val, o + 8); };
  tiff.writeUInt16BE(2, 8); entry(10, 0x010f, 2, 6, 100); entry(22, 0x8825, 4, 1, 40); tiff.write('Canon\0', 100, 'latin1');
  tiff.writeUInt16BE(4, 40);
  tiff.writeUInt16BE(1, 42); tiff.writeUInt16BE(2, 44); tiff.writeUInt32BE(2, 46); tiff.write('N\0', 50, 'latin1');
  entry(54, 2, 5, 3, 110);
  tiff.writeUInt16BE(3, 66); tiff.writeUInt16BE(2, 68); tiff.writeUInt32BE(2, 70); tiff.write('W\0', 74, 'latin1');
  entry(78, 4, 5, 3, 140);
  [[52, 1], [30, 1], [0, 1]].forEach(([n, d], i) => { tiff.writeUInt32BE(n, 110 + i * 8); tiff.writeUInt32BE(d, 114 + i * 8); });
  [[4, 1], [15, 1], [0, 1]].forEach(([n, d], i) => { tiff.writeUInt32BE(n, 140 + i * 8); tiff.writeUInt32BE(d, 144 + i * 8); });
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.writeUInt32BE(pixel(x / w, y / h), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(b)); return Buffer.concat([l, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('EXIF GPS and camera', () => {
  const j = exifJpeg();
  assert.equal(sniff(j), 'image/jpeg');
  const x = readExif(j);
  assert.equal(x.make, 'Canon');
  assert.equal(x.lat, 52.5);
  assert.equal(x.lon, -4.25);
});

test('perceptual hash matches resized copies and separates different pictures', () => {
  const scene = (x, y) => { const v = Math.floor(127 + 120 * Math.sin(x * 7) * Math.cos(y * 5)); return ((v << 24) | (v << 16) | (v << 8) | 255) >>> 0; };
  const other = (x, y) => { const v = Math.floor(255 * ((x * 3 + y * 2) % 1)); return ((v << 24) | (v << 16) | (v << 8) | 255) >>> 0; };
  const a = fingerprint(png(180, 180, scene), 'image/png');
  const b = fingerprint(png(64, 64, scene), 'image/png');
  const c = fingerprint(png(180, 180, other), 'image/png');
  const dist = (p, q) => [...(BigInt(`0x${p}`) ^ BigInt(`0x${q}`)).toString(2)].filter((ch) => ch === '1').length;
  assert.equal(a.width, 180);
  assert.ok(dist(a.phash, b.phash) <= 4, `resized copy distance ${dist(a.phash, b.phash)}`);
  assert.ok(dist(a.phash, c.phash) > 12, `different picture distance ${dist(a.phash, c.phash)}`);
  assert.notEqual(a.sha256, b.sha256);
});
