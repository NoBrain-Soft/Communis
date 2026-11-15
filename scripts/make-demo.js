// Builds public/demo.json: a small, entirely fictional investigation that shows how entities link up.
import { writeFileSync } from 'node:fs';
import { keyOf } from '../shared/entities.js';

const nodes = [];
const edges = [];
const N = (type, value, extra = {}) => { nodes.push({ type, value, label: '', props: {}, sources: ['demo'], notes: '', ...extra }); return keyOf(type, value); };
const E = (a, b, label) => edges.push({ source: a, target: b, label, module: 'demo' });

const dom = N('domain', 'northwind-labs.example', { props: { registered: '2016-03-11', expires: '2027-03-11', registrar: 'Example Registrar Ltd', title: 'Northwind Labs – applied research' }, notes: 'Starting point of the demo.' });
const www = N('domain', 'www.northwind-labs.example');
const mail = N('domain', 'mail.northwind-labs.example');
const vpn = N('domain', 'vpn.northwind-labs.example');
const dev = N('domain', 'dev.northwind-labs.example');
const ns1 = N('domain', 'ns1.hosting.example');
const ip1 = N('ip', '203.0.113.24', { props: { country: 'NL', isp: 'Example Hosting BV' } });
const ip2 = N('ip', '203.0.113.87');
const ip3 = N('ip', '198.51.100.7');
const net = N('netblock', '203.0.113.0/24', { props: { name: 'EXAMPLE-HOSTING-NL' } });
const asn = N('asn', 'AS64500', { label: 'AS64500 Example Hosting' });
const host = N('organization', 'Example Hosting BV');
const org = N('organization', 'Northwind Labs');
const ams = N('location', 'Amsterdam, North Holland, Netherlands', { props: { lat: 52.37, lon: 4.89 } });
const s443 = N('service', '203.0.113.24:443', { label: ':443' });
const s22 = N('service', '203.0.113.87:22', { label: ':22' });
const s3389 = N('service', '198.51.100.7:3389', { label: ':3389' });
const nginx = N('technology', 'nginx 1.18.0');
const wp = N('technology', 'WordPress');
const ssh = N('technology', 'openbsd openssh 7.4');
const cve = N('vulnerability', 'CVE-2021-23017');
const cert = N('certificate', 'a3f1c09e5d7b42e88f10c6aa91d3b7e45c2f8d016e9a7b34c5d8e2f1a0b9c8d7', { label: 'northwind-labs.example', props: { issuer: "Let's Encrypt", valid_to: 'Mar 02 2027' } });
const other = N('domain', 'fjord-analytics.example', { notes: 'Different company name, same certificate and same admin e-mail.' });

const mara = N('person', 'Mara Lindqvist', { props: { occupation: 'researcher', description: 'Fictional person for the demo' } });
const jonas = N('person', 'Jonas Adeyemi');
const em1 = N('email', 'mara@northwind-labs.example');
const em2 = N('email', 'jonas.adeyemi@northwind-labs.example');
const em3 = N('email', 'hostmaster@fjord-analytics.example');
const u1 = N('username', 'mlindqvist');
const u2 = N('username', 'jadeyemi', { props: { confidence: 'guess' } });
const gh = N('profile', 'https://github.com/mlindqvist-demo', { label: 'GitHub: mlindqvist', props: { site: 'GitHub', username: 'mlindqvist', public_repos: 23 } });
const ma = N('profile', 'https://mastodon.example/@mlindqvist', { label: 'Mastodon: mlindqvist', props: { site: 'Mastodon' } });
const li = N('profile', 'https://www.linkedin.com/in/jonas-adeyemi-demo', { label: 'LinkedIn: jonas-adeyemi', props: { site: 'LinkedIn' } });
const phone = N('phone', '+31205550142');
const nl = N('location', 'Netherlands');
const uni = N('organization', 'Delft Institute of Technology (fictional)');
const blog = N('url', 'https://mara-writes.example/about');

E(www, dom, 'subdomain'); E(mail, dom, 'subdomain'); E(vpn, dom, 'subdomain'); E(dev, dom, 'subdomain');
E(dom, ns1, 'name server'); E(other, ns1, 'name server');
E(dom, ip1, 'A record'); E(www, ip1, 'A record'); E(other, ip1, 'A record'); E(dev, ip2, 'A record'); E(vpn, ip3, 'A record');
E(dom, mail, 'mail server'); E(mail, ip2, 'A record');
E(ip1, net, 'part of'); E(ip2, net, 'part of'); E(ip1, asn, 'announced by'); E(ip2, asn, 'announced by'); E(asn, host, 'operated by'); E(asn, net, 'announces');
E(ip1, ams, 'located in'); E(ip1, s443, 'open port'); E(ip2, s22, 'open port'); E(ip3, s3389, 'open port');
E(ip1, nginx, 'runs'); E(ip2, ssh, 'runs'); E(ip1, cve, 'may be affected by'); E(dom, wp, 'uses');
E(dom, cert, 'presents'); E(cert, other, 'valid for'); E(cert, www, 'valid for'); E(cert, org, 'issued to');
E(dom, org, 'registrant'); E(dom, em1, 'mentions'); E(dom, em2, 'mentions'); E(dom, phone, 'mentions'); E(phone, nl, 'country code');
E(other, em3, 'registrant email'); E(dom, em3, 'DMARC reports');
E(em1, u1, 'local part'); E(em1, dom, 'mail domain'); E(em2, dom, 'mail domain'); E(em3, other, 'mail domain');
E(u1, gh, 'has account'); E(u1, ma, 'has account'); E(gh, mara, 'name on profile'); E(gh, org, 'works at'); E(gh, ams, 'located in'); E(gh, blog, 'website'); E(gh, em1, 'public email');
E(ma, blog, 'website'); E(mara, uni, 'educated at'); E(jonas, uni, 'educated at'); E(mara, jonas, 'co-author');
E(dom, jonas, 'names'); E(jonas, u2, 'possible username'); E(dom, li, 'links to profile'); E(li, jonas, 'name on profile'); E(blog, em3, 'mentions');

writeFileSync(new URL('../public/demo.json', import.meta.url), JSON.stringify({ name: 'Demo: Northwind Labs (fictional)', nodes, edges }, null, 1));
console.log(`${nodes.length} nodes, ${edges.length} edges`);
