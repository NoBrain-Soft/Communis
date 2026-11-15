# Communis

A graphical OSINT link-analysis tool. Start from one thing you know (a name, e-mail, username, photo,
domain, IP address), run searches on it, and every result becomes a node in a graph. An entity that turns
up from several directions is the same node, so connections between people, accounts and infrastructure
appear on their own.

![Communis showing the demo graph](docs/screenshot.png)

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Then open http://127.0.0.1:4780. Click **load the demo graph** on the empty screen for a fictional example.

Options (environment variables): `PORT`, `HOST` (default `127.0.0.1`), `COMMUNIS_DATA` (default `./data`),
`GITHUB_TOKEN`. Behind an HTTP proxy, start with `NODE_USE_ENV_PROXY=1` so searches honour `HTTPS_PROXY`.

## What it does

- **18 entity types** – people side: person, username, e-mail, phone, profile, photo; context: organization,
  location, phrase; infrastructure: domain, IP, netblock, AS number, URL, service, certificate, technology,
  vulnerability. The add box detects the type of what you type.
- **Searches** on any node (right-click, or the panel on the right). *Run all searches* runs every automatic
  one; *Discover 2 levels* repeats that on whatever is found.
- **Automatic linking** – values are normalised, so `Bob@Example.com` found on a web page and
  `bob@example.com` found in a WHOIS record are one node with two links. Pictures are fingerprinted, so the
  same avatar used on two accounts is linked even if it was resized or re-encoded.
- **Extract from text** – paste a report, log or e-mail; addresses, URLs, social profiles, IPs, domains,
  phone numbers and CVE ids are pulled out.
- **Readable results** – the default *Organised* layout sorts each hub's neighbours by type and puts a
  person's e-mail, phone, portrait and profiles directly behind that person. Roles and other key facts are
  shown under the names (toggle in the sidebar). With nothing selected, the right panel is a sorted
  overview: every person with role and contact details and an *Investigate* button, then all other
  entities by type. A misclassified entity can be corrected with *Wrong type?*.
- **Faces and pictures** – pictures on a page are checked for faces; faces in group pictures are cut out
  as their own photo entities. Detection runs locally and finds frontal faces; it does not identify anyone.
- **Edit by hand** – add, change or remove facts on any entity (role, employer, …), link further
  information to it (an e-mail, a profile URL, an employer), attach photos, draw a link between two selected
  entities, mark a candidate as verified. Searches and templates use hand-added data like anything else.
- **Shared index across investigations** – an entity that also exists in another investigation gets a gold
  double ring and an *Also in other investigations* box, from which its links can be copied over
  (*Bring links here*) or the other investigation opened.
- **News** – *News & press mentions* searches Google News for a region and, separately, only the news sites
  you list in Settings (e.g. `tips.at`). Reading an article links it to every person and organisation
  already in the graph that it mentions.
- **Analysis** – select two nodes and *Show how they connect* traces the shortest path; search and type
  filters; several layouts; notes per entity; "look up elsewhere" links (Shodan, VirusTotal, reverse image
  search, …).
- **Investigations** are saved automatically in `data/` and can be exported as JSON, CSV or PNG.

### Templates

Ready-made investigations that run several searches in sequence (the **Templates** button, or on any
matching node):

| Template | Starts from | What it does |
|---|---|---|
| People behind a website | domain, URL | Crawls the home page plus team/about/contact/imprint pages, finds the people named there with role, e-mail, phone, portrait and social profiles, adds the domain registrant, then looks up each address |
| Investigate a person | person | Searches LinkedIn, Facebook, X, Instagram, GitHub and the web for the name (narrowed by the organisation the person is linked to in the graph), Wikidata, then the person's e-mails, usernames and pictures |
| Trace an e-mail address | e-mail | Gravatar and GitHub identities, mentions, mail domain, same handle on other sites |
| Follow a username | username | Accounts on 16 sites, what they publish, which share an avatar |
| Map a domain's infrastructure | domain | DNS, registration, certificates, subdomains, then servers, networks, ports and CVEs |
| News & press coverage | person, organization, technology, phrase | Finds articles, reads the top ones and links them to known people and organisations they mention |
| Technology exposure | technology | Known vulnerabilities and their details, recent news |
| Profile an IP address | IP | Location, operator, exposed services, co-hosted sites |

![Result of the People behind a website template on a test site](docs/template-people.png)

Typical flow: run *People behind a website*, click one of the people it found, run *Investigate a person*.
Templates live in `public/templates.js`; adding one is a few lines listing which modules run on which
entity types at each step.

### Search modules

| Module | Input | Source | Finds |
|---|---|---|---|
| DNS records | domain | DNS (DoH fallback) | IPs, mail/name servers, SPF and DMARC relations |
| Reverse DNS | IP | DNS | host name |
| Domain registration | domain | rdap.org | registrar, contacts, name servers, dates |
| Subdomains from certificates | domain | crt.sh | subdomains |
| TLS certificate | domain, IP | target host | certificate, alternative names, owner |
| Scrape web page | domain, URL, profile | target site | e-mails, phones, social profiles, people, images, technologies, linked sites |
| Crawl site for people & contacts | domain, URL | target site (up to 14 pages) | people with role, e-mail, phone, portrait, profiles; shared contact details |
| Find social profiles | person | DuckDuckGo | candidate LinkedIn, Facebook, X, Instagram, GitHub profiles |
| Pictures of people on this page | domain, URL, profile | target site | pictures containing faces, individual face crops |
| News & press mentions | person, organization, technology, phrase, … | Google News, your news sites via DuckDuckGo | articles with source and date |
| WHOIS record | domain | registry WHOIS (port 43) | holder, contacts, address, name servers, dates; covers ccTLDs such as .at/.de |
| Known vulnerabilities | technology | NVD | CVEs with severity for the product/version |
| Vulnerability details | vulnerability | NVD | description, score, affected products, references |
| Archived pages | domain | Wayback Machine | old URLs, documents, forgotten subdomains |
| IP allocation | IP, netblock | rdap.org | netblock, holder, abuse contact |
| IP geolocation & ASN | IP | ipwho.is | location, AS number, operator |
| Open ports & vulnerabilities | IP | Shodan InternetDB | ports, host names, software, CVEs (passive) |
| Other sites on this IP | IP | HackerTarget | co-hosted domains |
| AS holder & prefixes | AS number | RIPEstat | operator, announced networks |
| Find accounts by username | username | 16 sites (GitHub, GitLab, Reddit, Keybase, Bluesky, Mastodon, Telegram, …) | profiles, real names, avatars, locations, linked accounts |
| Gravatar profile | e-mail | Gravatar | avatar, name, verified accounts |
| GitHub by e-mail | e-mail | GitHub | accounts and commit author names |
| GitHub by name | person, organization | GitHub | candidate accounts |
| Guess usernames | person | local | likely handles to test |
| Wikidata knowledge graph | person, organization | Wikidata | relatives, employers, memberships, places, official accounts, photo |
| Academic affiliations | person | OpenAlex | institutions, co-authors |
| Web search | person, e-mail, username, phone, organization, phrase | DuckDuckGo | pages mentioning the value |
| Geocode place | location | OpenStreetMap | coordinates, country |
| Analyse photo | photo | the image | GPS position, camera, date, fingerprint |
| Phone country / Break apart | phone, e-mail, URL, … | local | country; parts of a value |

None needs an API key. Web and social-profile search use DuckDuckGo's HTML page, which refuses automated
queries from some networks (data centres in particular); a Brave Search API key or a SearXNG address can be
set under Settings as a reliable alternative. News sites and region are set under Settings (gear icon). A GitHub token (Settings) only raises GitHub's rate limit.
Four modules contact the target itself (*Scrape web page*, *Crawl site for people & contacts*, *Pictures of people on this page*, *TLS certificate*); all others query third parties.

### Adding a module

Drop a file in `server/modules/` that default-exports an object (or array of objects):

```js
export default {
  id: 'my_lookup', name: 'My lookup', group: 'Infrastructure', source: 'example.org',
  description: 'What it finds.',
  inputs: ['domain'],                       // entity types it accepts
  async run({ type, value, props }, ctx) {  // ctx.http.json / text / raw, ctx.settings
    const data = await ctx.http.json(`https://example.org/api?q=${value}`);
    return {
      entities: [{ type: 'ip', value: data.ip, rel: 'resolves to' }], // rel = label of the link from the input
      props: { note: data.note },           // facts added to the input entity
      notes: ['shown in the activity log'],
    };
  },
};
```

An entity may set `from: 'type:value'` to hang off another result instead of the input, `reverse: true` to
point the link at the input, and `props.confidence` to mark it as an unverified guess.

## Notes

- The server only listens on localhost and rejects requests from other origins. It fetches whatever URLs
  you point it at, so do not expose it to a network you do not trust.
- The people crawler also reads imprint-style text: lines such as `Geschäftsführung: Mag. A B, DI C D`, names
  carrying academic titles (Mag., Dr., DI (FH), Prof., MBA, …), `Name, Role` pairs, and company facts
  (VAT/UID number, company register number and court, legal form, address).
- The crawler separates **people of the organisation** (a card with a role or contact, an imprint line, a
  personal address at the site's domain, or a role that names the organisation) from people who are **only
  mentioned** in its texts (a politician at an opening, a testimonial author). The latter are drawn faded with
  a dotted ring, linked with "mentioned on site" / "mentions", and listed separately in the overview.
- Press and news pages are read as **press items** (dated headlines, also when they are accordions on one
  page), each linked to the people its text names, with the description used there as their role
  ("Upper Austrian Governor").
- The people crawler reads plain HTML. It recognises names in headings and structured data next to a role
  or contact detail; sites rendered by JavaScript, or unusual layouts, will be missed or need checking.
- Results are leads, not facts: name matches (Wikidata, OpenAlex, GitHub by name) can be a different
  person, and IP geolocation is approximate. Unverified candidates are drawn dashed.
- Use it for lawful purposes only: your own assets, authorised security assessments, journalism and
  research within the privacy laws that apply to you (e.g. GDPR).

## Tests

```bash
npm test
```

The portrait used as a test fixture (`test/fixtures/portrait.png`) is a public-domain NASA photograph.

## Live test status

![People behind a website, run on a live site](docs/live-richter.png)

Run against real services and sites (richter-pharma.com in German and English, eff.org, python.org, tips.at):
people crawler, press items, pictures and face crops, web scrape, DNS (DoH fallback), certificate
transparency, IP geolocation, Shodan InternetDB, Wikidata, Google News, NVD (CVE lookup and details).

Not yet run against the real service: WHOIS on port 43, RDAP (its registry redirects were not reachable from
the test network), DuckDuckGo-based web/social search and the optional Brave/SearXNG route (the engines refused
the test network), username check, Gravatar, GitHub, OpenAlex, geocoding, Wayback, reverse IP, AS prefixes,
TLS certificate.
