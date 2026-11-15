// Ready-made investigations. Each step runs the listed searches on every entity of the given types that the
// template has found so far ('start' = the entity it was started from).
export const TEMPLATES = [
  {
    id: 'site_people', name: 'People behind a website', action: 'Find the people on this site', inputs: ['domain', 'url'], placeholder: 'example.com',
    description: 'Crawls the site for the people named on it and their contact details, adds who registered the domain, then looks up every e-mail address found. Afterwards click a person and run “Investigate a person”.',
    steps: [
      { label: 'Crawling the site and reading the registration', on: 'start', modules: ['site_people', 'rdap_domain'] },
      { label: 'Looking up the e-mail addresses', on: ['email'], modules: ['email_gravatar', 'email_github'], limit: 15 },
      { label: 'Fingerprinting portraits', on: ['photo'], modules: ['photo_analyze'], limit: 15 },
    ],
  },
  {
    id: 'person', name: 'Investigate a person', action: 'Investigate this person', inputs: ['person'], placeholder: 'Jane Doe',
    description: 'Searches the web and LinkedIn, Facebook, X, Instagram and GitHub for the name (narrowed by the organisation the person is linked to), checks Wikidata, then follows the person’s e-mail addresses and confirmed accounts.',
    steps: [
      { label: 'Searching the web and social networks', on: 'start', modules: ['social_search', 'web_search', 'wikidata', 'person_github'] },
      { label: 'Looking up known e-mail addresses', on: ['email'], neighbours: true, modules: ['email_gravatar', 'email_github'], limit: 6 },
      { label: 'Checking confirmed usernames on other sites', on: ['username'], modules: ['username_hunt'], limit: 4 },
      { label: 'Fingerprinting pictures', on: ['photo'], neighbours: true, modules: ['photo_analyze'], limit: 10 },
    ],
  },
  {
    id: 'email', name: 'Trace an e-mail address', action: 'Trace this address', inputs: ['email'], placeholder: 'someone@example.org',
    description: 'Who is behind an address: Gravatar and GitHub identities, pages that mention it, its mail domain, and accounts registered under the same handle.',
    steps: [
      { label: 'Looking up the address', on: 'start', modules: ['decompose', 'email_gravatar', 'email_github', 'web_search'] },
      { label: 'Trying the handle on other sites', on: ['username'], guesses: true, modules: ['username_hunt'], limit: 3 },
      { label: 'Fingerprinting pictures', on: ['photo'], modules: ['photo_analyze'], limit: 10 },
    ],
  },
  {
    id: 'username', name: 'Follow a username', action: 'Follow this username', inputs: ['username'], placeholder: 'handle',
    description: 'Finds accounts with this handle on 16 sites, collects the names, places and links they publish, and compares the avatars to see which accounts share a picture.',
    steps: [
      { label: 'Checking sites for the handle', on: 'start', modules: ['username_hunt'] },
      { label: 'Comparing avatars', on: ['photo'], modules: ['photo_analyze'], limit: 20 },
      { label: 'Looking up published e-mail addresses', on: ['email'], modules: ['email_gravatar'], limit: 5 },
    ],
  },
  {
    id: 'infrastructure', name: 'Map a domain’s infrastructure', action: 'Map its infrastructure', inputs: ['domain'], placeholder: 'example.com',
    description: 'DNS, registration, certificate and sub-domains of a domain, then location, network owner, open ports and known vulnerabilities of the servers behind it.',
    steps: [
      { label: 'Reading DNS, registration and certificates', on: 'start', modules: ['dns_records', 'rdap_domain', 'crtsh', 'tls_cert', 'web_scrape'] },
      { label: 'Resolving sub-domains', on: ['domain'], modules: ['dns_records'], limit: 15 },
      { label: 'Profiling the servers', on: ['ip'], modules: ['ip_geo', 'internetdb', 'rdap_ip', 'reverse_dns'], limit: 12 },
      { label: 'Identifying the networks', on: ['asn'], modules: ['asn_prefixes'], limit: 3 },
    ],
  },
  {
    id: 'ip', name: 'Profile an IP address', action: 'Profile this server', inputs: ['ip'], placeholder: '203.0.113.10',
    description: 'Where a server is, who runs it, what it exposes, and which other sites share it.',
    steps: [
      { label: 'Profiling the server', on: 'start', modules: ['ip_geo', 'internetdb', 'rdap_ip', 'reverse_dns', 'reverse_ip', 'tls_cert'] },
      { label: 'Identifying the network', on: ['asn'], modules: ['asn_prefixes'], limit: 2 },
    ],
  },
];
