import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personName, extractPeople, emailNameMatch } from '../server/lib/people.js';
import { loadModules, runModule } from '../server/index.js';

const mods = await loadModules();
const page = (url, html) => ({ status: 200, url, headers: new Headers({ 'content-type': 'text/html' }), buf: Buffer.from(html) });

const HOME = `<html><head><meta property="og:site_name" content="Acme Robotics"></head><body>
  <nav><a href="/">Home</a><a href="/products/arm">Products</a><a href="/about/team">Our Team</a><a href="/contact">Contact</a><a href="https://other.test/x">ext</a><a href="/brochure.pdf">PDF</a></nav>
  <h1>Welcome Home</h1><h2>Latest News</h2><p>Robots for everyone.</p><footer>info@acme.test</footer></body></html>`;
const TEAM = `<html><body><h1>Meet Our Team</h1>
  <div class="card"><img src="/img/jane.jpg" alt=""><h3>Dr. Jane Doe</h3><p class="role">Chief Executive Officer</p>
    <a href="mailto:jane.doe@acme.test">Email</a> <a href="tel:+15550101">Call</a> <a href="https://www.linkedin.com/in/janedoe">LinkedIn</a></div>
  <div class="card"><img src="/img/raj.jpg"><h3><a href="/about/team/raj-patel">Raj Patel</a></h3><p>Head of Engineering</p><a href="https://github.com/rajp">GitHub</a></div>
  <div class="card"><h3>María de la Cruz</h3><p>Sales Manager, EMEA</p></div>
  <h3>Join Us</h3><p>We are hiring.</p>
  <footer><a href="mailto:info@acme.test">info@acme.test</a> <a href="https://x.com/acmerobots">X</a></footer></body></html>`;
const CONTACT = `<html><body><h1>Contact Us</h1><p>Press: r.patel is not an address. Write to rpatel@acme.test or sales@acme.test, +1 555 0100</p>
  <a href="tel:+15550100">Call us</a><script type="application/ld+json">{"@type":"Person","name":"Tom Okafor","jobTitle":"Press Officer","email":"mailto:tom@acme.test"}</script></body></html>`;

test('person name recognition', () => {
  for (const ok of ['Jane Doe', 'Dr. Jane Doe', 'Jean-Luc Picard', 'María de la Cruz', 'John F. Kennedy', "Conan O'Brien", 'Ludwig van Beethoven', 'Jane Doe, PhD'])
    assert.ok(personName(ok), ok);
  assert.equal(personName('Dr. Jane Doe, PhD'), 'Jane Doe');
  for (const bad of ['Our Team', 'Contact Us', 'Latest News', 'Privacy Policy', 'ACME', 'Welcome Home', 'Join Us', 'Read More', 'Acme Robotics 2024', 'jane doe', 'Meet Our Team'])
    assert.equal(personName(bad), '', bad);
});

test('team page: each person gets their own role, contacts and portrait', () => {
  const people = Object.fromEntries(extractPeople(TEAM, 'https://acme.test/about/team').map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(people).sort(), ['Jane Doe', 'María de la Cruz', 'Raj Patel']);
  assert.equal(people['Jane Doe'].role, 'Chief Executive Officer');
  assert.deepEqual(people['Jane Doe'].emails, ['jane.doe@acme.test']);
  assert.deepEqual(people['Jane Doe'].phones, ['+15550101']);
  assert.equal(people['Jane Doe'].profiles[0].url, 'https://www.linkedin.com/in/janedoe');
  assert.equal(people['Jane Doe'].image, 'https://acme.test/img/jane.jpg');
  assert.equal(people['Raj Patel'].role, 'Head of Engineering');
  assert.equal(people['Raj Patel'].image, 'https://acme.test/img/raj.jpg');
  assert.equal(people['Raj Patel'].profiles[0].site, 'GitHub');
  assert.equal(people['María de la Cruz'].role, 'Sales Manager, EMEA');
});

test('e-mail to name matching', () => {
  assert.equal(emailNameMatch('jane.doe@x.test', 'Jane Doe'), 2);
  assert.equal(emailNameMatch('jdoe@x.test', 'Jane Doe'), 2);
  assert.equal(emailNameMatch('maria.cruz@x.test', 'María de la Cruz'), 2);
  assert.equal(emailNameMatch('jane@x.test', 'Jane Doe'), 1);
  assert.equal(emailNameMatch('info@x.test', 'Jane Doe'), 0);
});

test('site crawl follows people pages and attributes contacts', async () => {
  const requested = [];
  const http = { async raw(url) {
    requested.push(url);
    const path = new URL(url).pathname;
    const html = { '/': HOME, '/about/team': TEAM, '/contact': CONTACT, '/about/team/raj-patel': '<html><body><h1>Raj Patel</h1><p>Head of Engineering</p><a href="tel:+15550177">Direct line</a></body></html>' }[path];
    if (html == null) throw new Error(`404 ${url}`);
    return page(url, html);
  } };
  const r = await runModule(mods.get('site_people'), { type: 'domain', value: 'acme.test' }, {}, http);
  assert.ok(!requested.some((u) => /other\.test|\.pdf/.test(u)), 'stays on the site and skips files');
  assert.ok(requested.includes('https://acme.test/about/team') && requested.includes('https://acme.test/contact') && requested.includes('https://acme.test/about/team/raj-patel'));
  const by = Object.fromEntries(r.entities.map((e) => [e.key, e]));
  for (const k of ['person:jane doe', 'person:raj patel', 'person:maría de la cruz', 'person:tom okafor', 'organization:acme robotics']) assert.ok(by[k], k);
  assert.equal(by['person:jane doe'].props.role, 'Chief Executive Officer');
  const owner = (k) => by[k].edges.map((e) => e.from);
  assert.deepEqual(owner('email:jane.doe@acme.test'), ['person:jane doe']);
  assert.deepEqual(owner('email:rpatel@acme.test'), ['person:raj patel'], 'address matched to its owner by name');
  assert.deepEqual(owner('phone:+15550177'), ['person:raj patel']);
  assert.deepEqual(owner('email:tom@acme.test'), ['person:tom okafor']);
  assert.deepEqual(owner('profile:https://www.linkedin.com/in/janedoe'), ['person:jane doe']);
  assert.deepEqual(owner('photo:https://acme.test/img/jane.jpg'), ['person:jane doe']);
  assert.deepEqual(owner('email:info@acme.test'), ['domain:acme.test'], 'shared addresses stay with the site');
  assert.deepEqual(owner('email:sales@acme.test'), ['domain:acme.test']);
  assert.deepEqual(owner('profile:https://x.com/acmerobots'), ['domain:acme.test']);
  assert.ok(!Object.keys(by).some((k) => /join us|welcome|latest/.test(k)));
  assert.equal(r.props.people_found, 4);
});

test('social profile search uses graph context and keeps only plausible profiles', async () => {
  const queries = [];
  const hit = (href, title) => `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(href)}&rut=x">${title}</a>`;
  const http = { async text(url) {
    const q = new URL(url).searchParams.get('q');
    queries.push(q);
    if (q.includes('linkedin')) return hit('https://www.linkedin.com/in/jane-doe-123', 'Jane Doe - CEO - Acme Robotics | LinkedIn') + hit('https://www.linkedin.com/in/bob-smith', 'Bob Smith | LinkedIn') + hit('https://www.linkedin.com/pulse/some-article', 'Jane Doe on robots');
    if (q.includes('facebook')) return hit('https://www.facebook.com/jane.doe.77', 'Jane Doe | Facebook');
    throw new Error('rate limited');
  } };
  const r = await runModule(mods.get('social_search'), { type: 'person', value: 'Jane Doe', context: { orgs: ['Acme Robotics'], domains: ['acme.test'] } }, {}, http);
  assert.ok(queries[0].includes('"Jane Doe" Acme Robotics site:linkedin.com/in'));
  assert.deepEqual(r.entities.map((e) => e.key), ['profile:https://www.linkedin.com/in/jane-doe-123', 'profile:https://www.facebook.com/jane.doe.77']);
  assert.equal(r.entities[0].props.confidence, 'candidate');
  assert.match(r.notes.join(' '), /other networks/);
});

test('section headings and company names are not people (German site)', async () => {
  for (const bad of ['Unsere Ziele', 'Unser Nachhaltigkeitsbericht', 'Richter Pharma', 'Über Uns', 'Unsere Werte', 'Acme Holding', 'Notre Équipe', 'Quienes Somos'])
    assert.equal(personName(bad), '', bad);
  const about = `<html><body><h1>Über uns</h1>
    <h2>Unsere Ziele</h2><p>Wir wollen wachsen. Unser Vertrieb und Marketing helfen dabei. office@richter-test.at</p>
    <h2>Nordwind Handel</h2><p>Seit 1950 für Sie da.</p>
    <h2>Geschäftsführung</h2>
    <h3>Mag. Roland Huemer</h3><p>Geschäftsführer</p>
    <h3>Stefan Reisinger</h3><p>Leiter Vertrieb</p><a href="mailto:stefan.reisinger@richter-test.at">E-Mail</a>
    <h3>Marlene Pramhaas</h3><p>Seit 2019 im Team.</p>
    <h3>Xyrq Zvolt</h3><p>Seit 2020 im Team.</p></body></html>`;
  const http = { async raw(url) {
    const html = { '/': '<html><head><meta property="og:site_name" content="Nordwind Handel"></head><body><a href="/ueber-uns">Über uns</a></body></html>', '/ueber-uns': about }[new URL(url).pathname];
    if (html == null) throw new Error('404');
    return page(url, html);
  } };
  const r = await runModule(mods.get('site_people'), { type: 'domain', value: 'nordwind-handel.test' }, {}, http);
  const persons = Object.fromEntries(r.entities.filter((e) => e.type === 'person').map((e) => [e.value, e.props]));
  assert.deepEqual(Object.keys(persons).sort(), ['Marlene Pramhaas', 'Roland Huemer', 'Stefan Reisinger']);
  assert.equal(persons['Roland Huemer'].role, 'Geschäftsführer');
  assert.equal(persons['Roland Huemer'].confidence, undefined);
  assert.equal(persons['Stefan Reisinger'].role, 'Leiter Vertrieb');
});

test('titles, imprint lines and company facts (Austrian-style site)', async () => {
  const { parseName, peopleInText, companyFacts, blockText } = await import('../server/lib/people.js');
  assert.deepEqual(parseName('Mag. Roland Huemer, MBA'), { name: 'Roland Huemer', title: 'Mag. MBA' });
  assert.deepEqual(parseName('DI (FH) Anna Berger'), { name: 'Anna Berger', title: 'DI (FH)' });
  assert.deepEqual(parseName('Univ.-Prof. Dr. Karl Maier'), { name: 'Karl Maier', title: 'Univ.-Prof. Dr.' });
  assert.equal(parseName('Dr.in Eva Novak').name, 'Eva Novak');
  const html = `<html><body><h1>Impressum</h1><div><p><strong>Nordwind Pharma GmbH</strong><br>Feldgasse 19, 4600 Wels<br>Österreich</p>
    <p>Geschäftsführung: Mag. Roland Huemer, DI Florian Fellinger und Dr. Petra Lang, MBA</p>
    <p>Prokurist: Stefan Reisinger</p>
    <p>Firmenbuchnummer: FN 123456 a<br>Firmenbuchgericht: Landesgericht Wels<br>UID-Nr.: ATU 12345678</p>
    <p>Unser Vertrieb erreicht Sie unter office@nordwind-test.at. Ihre Ansprechpartnerin im Außendienst ist Marlene Pramhaas, Gebietsleiterin Oberösterreich.</p>
    <p>Qualitätssicherung und Produkte seit 1949.</p></div></body></html>`;
  const text = blockText(html);
  const people = Object.fromEntries(peopleInText(text).map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(people).sort(), ['Florian Fellinger', 'Marlene Pramhaas', 'Petra Lang', 'Roland Huemer', 'Stefan Reisinger']);
  assert.equal(people['Roland Huemer'].role, 'Geschäftsführung');
  assert.equal(people['Roland Huemer'].title, 'Mag.');
  assert.equal(people['Petra Lang'].title, 'Dr. MBA');
  assert.equal(people['Stefan Reisinger'].role, 'Prokurist');
  assert.equal(people['Marlene Pramhaas'].role, 'Gebietsleiterin Oberösterreich');
  assert.deepEqual(companyFacts(text), { vat_id: 'ATU 12345678', company_register: '123456 a', register_court: 'Landesgericht Wels', legal_form: 'GmbH', address: 'Feldgasse 19, 4600 Wels' });

  const http = { async raw(url) {
    const h = { '/': '<html><head><meta property="og:site_name" content="Nordwind Pharma"></head><body><a href="/impressum">Impressum</a></body></html>', '/impressum': html }[new URL(url).pathname];
    if (h == null) throw new Error('404');
    return page(url, h);
  } };
  const r = await runModule(mods.get('site_people'), { type: 'domain', value: 'nordwind-pharma.test' }, {}, http);
  const by = Object.fromEntries(r.entities.map((e) => [e.key, e]));
  assert.equal(by['person:roland huemer'].props.title, 'Mag.');
  assert.equal(by['organization:nordwind pharma'].props.vat_id, 'ATU 12345678');
  assert.ok(by['location:feldgasse 19, 4600 wels']);
  assert.equal(r.entities.filter((e) => e.type === 'person').length, 5);
});
