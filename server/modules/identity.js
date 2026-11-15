import { createHash } from 'node:crypto';

const gh = (ctx) => (ctx.settings.githubToken ? { authorization: `Bearer ${ctx.settings.githubToken}` } : {});
const enc = encodeURIComponent;

// Each site returns null when the account does not exist, otherwise what it publicly says about the owner.
const SITES = [
  { site: 'GitHub', async check(u, ctx) {
    const j = await ctx.http.json(`https://api.github.com/users/${enc(u)}`, { okStatuses: [404], headers: gh(ctx) });
    return j && { url: j.html_url, name: j.name, photo: j.avatar_url, location: j.location, org: j.company?.replace(/^@/, ''), email: j.email, website: j.blog,
      aliases: j.twitter_username ? [{ site: 'X', username: j.twitter_username, url: `https://x.com/${j.twitter_username}` }] : [],
      props: { bio: j.bio, created: j.created_at?.slice(0, 10), followers: j.followers, public_repos: j.public_repos } };
  } },
  { site: 'GitLab', async check(u, ctx) {
    const j = (await ctx.http.json(`https://gitlab.com/api/v4/users?username=${enc(u)}`))?.[0];
    return j && { url: j.web_url, name: j.name, photo: /^https?:/.test(j.avatar_url || '') ? j.avatar_url : null };
  } },
  { site: 'Codeberg', async check(u, ctx) {
    const j = await ctx.http.json(`https://codeberg.org/api/v1/users/${enc(u)}`, { okStatuses: [404] });
    return j && { url: `https://codeberg.org/${j.login}`, name: j.full_name, photo: j.avatar_url, location: j.location, website: j.website, props: { bio: j.description, created: j.created?.slice(0, 10) } };
  } },
  { site: 'Hacker News', async check(u, ctx) {
    const j = await ctx.http.json(`https://hacker-news.firebaseio.com/v0/user/${enc(u)}.json`);
    return j && { url: `https://news.ycombinator.com/user?id=${enc(j.id)}`, props: { karma: j.karma, created: new Date(j.created * 1000).toISOString().slice(0, 10), about: j.about?.replace(/<[^>]+>/g, ' ').slice(0, 300) } };
  } },
  { site: 'Keybase', async check(u, ctx) {
    if (!/^[a-z0-9_]{2,16}$/i.test(u)) return null;
    const j = await ctx.http.json(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${enc(u)}`);
    const t = j?.them?.[0];
    return t && { url: `https://keybase.io/${u}`, name: t.profile?.full_name, location: t.profile?.location, photo: t.pictures?.primary?.url,
      aliases: (t.proofs_summary?.all || []).filter((p) => p.service_url && p.nametag).map((p) => ({ site: p.proof_type, username: p.nametag, url: p.service_url, proven: true })),
      props: { bio: t.profile?.bio } };
  } },
  { site: 'Reddit', async check(u, ctx) {
    const j = await ctx.http.json(`https://www.reddit.com/user/${enc(u)}/about.json`, { okStatuses: [404] });
    const d = j?.data;
    return d?.name ? { url: `https://www.reddit.com/user/${d.name}`, photo: d.icon_img?.split('?')[0], props: { created: new Date(d.created_utc * 1000).toISOString().slice(0, 10), karma: d.total_karma } } : null;
  } },
  { site: 'DEV', async check(u, ctx) {
    const j = await ctx.http.json(`https://dev.to/api/users/by_username?url=${enc(u)}`, { okStatuses: [404] });
    if (!j?.username) return null;
    const aliases = [];
    if (j.github_username) aliases.push({ site: 'GitHub', username: j.github_username, url: `https://github.com/${j.github_username}` });
    if (j.twitter_username) aliases.push({ site: 'X', username: j.twitter_username, url: `https://x.com/${j.twitter_username}` });
    return { url: `https://dev.to/${j.username}`, name: j.name, photo: j.profile_image, location: j.location, website: j.website_url, aliases, props: { bio: j.summary } };
  } },
  { site: 'Docker Hub', async check(u, ctx) {
    const j = await ctx.http.json(`https://hub.docker.com/v2/users/${enc(u)}/`, { okStatuses: [404] });
    return j?.username ? { url: `https://hub.docker.com/u/${j.username}`, name: j.full_name, location: j.location, org: j.company, website: j.profile_url, props: { joined: j.date_joined?.slice(0, 10) } } : null;
  } },
  { site: 'Bluesky', async check(u, ctx) {
    const handle = u.includes('.') ? u : `${u}.bsky.social`;
    const j = await ctx.http.json(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${enc(handle)}`, { okStatuses: [400, 404] });
    return j?.handle ? { url: `https://bsky.app/profile/${j.handle}`, name: j.displayName, photo: j.avatar, props: { bio: j.description, followers: j.followersCount } } : null;
  } },
  { site: 'Mastodon', async check(u, ctx) {
    const j = await ctx.http.json(`https://mastodon.social/api/v1/accounts/lookup?acct=${enc(u)}`, { okStatuses: [400, 404] });
    return j?.url ? { url: j.url, name: j.display_name, photo: /missing\.png/.test(j.avatar || '') ? null : j.avatar,
      website: (j.fields || []).map((f) => f.value?.match(/href="(https?:[^"]+)"/)?.[1]).find(Boolean),
      props: { bio: j.note?.replace(/<[^>]+>/g, ' ').slice(0, 300), created: j.created_at?.slice(0, 10) } } : null;
  } },
  { site: 'Lichess', async check(u, ctx) {
    const j = await ctx.http.json(`https://lichess.org/api/user/${enc(u)}`, { okStatuses: [404] });
    return j?.id && !j.disabled ? { url: `https://lichess.org/@/${j.username}`, name: j.profile?.realName || [j.profile?.firstName, j.profile?.lastName].filter(Boolean).join(' '), location: j.profile?.location, props: { bio: j.profile?.bio } } : null;
  } },
  { site: 'Chess.com', async check(u, ctx) {
    const j = await ctx.http.json(`https://api.chess.com/pub/player/${enc(u.toLowerCase())}`, { okStatuses: [404, 410] });
    return j?.url ? { url: j.url, name: j.name, photo: j.avatar, location: j.location } : null;
  } },
  { site: 'npm', async check(u, ctx) {
    const j = await ctx.http.json(`https://registry.npmjs.org/-/v1/search?text=maintainer:${enc(u)}&size=1`);
    return j?.total > 0 ? { url: `https://www.npmjs.com/~${u}`, props: { packages: j.total } } : null;
  } },
  { site: 'PyPI', async check(u, ctx) {
    const r = await ctx.http.raw(`https://pypi.org/user/${enc(u)}/`, { okStatuses: [404], maxBytes: 20000 });
    return r.status === 200 ? { url: `https://pypi.org/user/${u}/` } : null;
  } },
  { site: 'Telegram', async check(u, ctx) {
    if (!/^[a-z0-9_]{4,32}$/i.test(u)) return null;
    const html = await ctx.http.text(`https://t.me/${enc(u)}`, { maxBytes: 200000 });
    const name = html.match(/<div class="tgme_page_title"[^>]*>\s*<span[^>]*>([^<]+)</)?.[1];
    if (!name) return null;
    return { url: `https://t.me/${u}`, name: name.trim(), nameIsDisplay: true, photo: html.match(/<img class="tgme_page_photo_image"[^>]+src="([^"]+)"/)?.[1] };
  } },
  { site: 'Steam', async check(u, ctx) {
    const html = await ctx.http.text(`https://steamcommunity.com/id/${enc(u)}`, { maxBytes: 300000 });
    if (/could not be found|<title>Steam Community :: Error/i.test(html)) return null;
    return { url: `https://steamcommunity.com/id/${u}`, props: { persona: html.match(/<span class="actual_persona_name">([^<]+)</)?.[1] } };
  } },
];

const looksLikeName = (s) => typeof s === 'string' && /^\p{L}[\p{L}'.-]+(\s+\p{L}[\p{L}'.-]*){1,3}$/u.test(s.trim());

/** Turn one site hit into graph entities hanging off the profile node. */
function profileEntities(site, username, hit, rel = 'has account') {
  const out = [];
  const pkey = `profile:${hit.url.replace(/\/$/, '').toLowerCase()}`;
  out.push({ type: 'profile', value: hit.url, label: `${site}: ${username}`, rel,
    props: { site, username, display_name: hit.name || undefined, ...Object.fromEntries(Object.entries(hit.props || {}).filter(([, v]) => v != null && v !== '')) } });
  if (looksLikeName(hit.name)) out.push({ type: 'person', value: hit.name.trim(), rel: 'name on profile', from: pkey });
  if (hit.photo) out.push({ type: 'photo', value: hit.photo, rel: 'avatar', from: pkey, label: `${site} avatar` });
  if (hit.location) out.push({ type: 'location', value: hit.location, rel: 'located in', from: pkey });
  if (hit.org) out.push({ type: 'organization', value: hit.org, rel: 'works at', from: pkey });
  if (hit.email) out.push({ type: 'email', value: hit.email, rel: 'public email', from: pkey });
  if (hit.website) out.push({ type: 'url', value: /^https?:/.test(hit.website) ? hit.website : `https://${hit.website}`, rel: 'website', from: pkey });
  for (const a of hit.aliases || []) {
    out.push({ type: 'profile', value: a.url, label: `${a.site}: ${a.username}`, rel: a.proven ? 'proven account' : 'linked account', from: pkey, props: { site: a.site, username: a.username } });
  }
  return out;
}

const CALLING_CODES = { 1: 'United States / Canada', 7: 'Russia / Kazakhstan', 20: 'Egypt', 27: 'South Africa', 30: 'Greece', 31: 'Netherlands', 32: 'Belgium',
  33: 'France', 34: 'Spain', 36: 'Hungary', 39: 'Italy', 40: 'Romania', 41: 'Switzerland', 43: 'Austria', 44: 'United Kingdom', 45: 'Denmark', 46: 'Sweden',
  47: 'Norway', 48: 'Poland', 49: 'Germany', 51: 'Peru', 52: 'Mexico', 54: 'Argentina', 55: 'Brazil', 56: 'Chile', 57: 'Colombia', 60: 'Malaysia', 61: 'Australia',
  62: 'Indonesia', 63: 'Philippines', 64: 'New Zealand', 65: 'Singapore', 66: 'Thailand', 81: 'Japan', 82: 'South Korea', 84: 'Vietnam', 86: 'China', 90: 'Turkey',
  91: 'India', 92: 'Pakistan', 93: 'Afghanistan', 94: 'Sri Lanka', 98: 'Iran', 212: 'Morocco', 213: 'Algeria', 216: 'Tunisia', 234: 'Nigeria', 254: 'Kenya',
  351: 'Portugal', 352: 'Luxembourg', 353: 'Ireland', 354: 'Iceland', 358: 'Finland', 370: 'Lithuania', 371: 'Latvia', 372: 'Estonia', 380: 'Ukraine',
  381: 'Serbia', 385: 'Croatia', 386: 'Slovenia', 420: 'Czechia', 421: 'Slovakia', 852: 'Hong Kong', 880: 'Bangladesh', 886: 'Taiwan', 961: 'Lebanon',
  962: 'Jordan', 966: 'Saudi Arabia', 971: 'United Arab Emirates', 972: 'Israel', 974: 'Qatar' };

export default [
  {
    id: 'username_hunt', name: 'Find accounts by username', group: 'People', source: `${SITES.length} sites`,
    description: `Checks ${SITES.map((s) => s.site).join(', ')} for this handle and pulls names, avatars, locations and linked accounts.`,
    inputs: ['username'],
    async run({ value }, ctx) {
      const results = await Promise.allSettled(SITES.map((s) => s.check(value, ctx)));
      const entities = [];
      const failed = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') failed.push(SITES[i].site);
        else if (r.value?.url) entities.push(...profileEntities(SITES[i].site, value, r.value));
      });
      if (failed.length === SITES.length) throw results[0].reason;
      return { entities, notes: failed.length ? [`Could not check: ${failed.join(', ')}.`] : [] };
    },
  },
  {
    id: 'email_gravatar', name: 'Gravatar profile', group: 'People', source: 'Gravatar',
    description: 'Avatar, display name and verified accounts registered for an e-mail address.',
    inputs: ['email'],
    async run({ value }, ctx) {
      const hash = createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
      const entities = [];
      const [profile, avatar] = await Promise.allSettled([
        ctx.http.json(`https://api.gravatar.com/v3/profiles/${hash}`, { okStatuses: [404] }),
        ctx.http.raw(`https://gravatar.com/avatar/${hash}?d=404&s=400`, { okStatuses: [404], maxBytes: 1000 }),
      ]);
      if (profile.status === 'rejected' && avatar.status === 'rejected') throw profile.reason;
      const p = profile.value;
      if (avatar.value?.status === 200) entities.push({ type: 'photo', value: `https://gravatar.com/avatar/${hash}?s=400`, label: 'Gravatar avatar', rel: 'avatar' });
      if (p?.profile_url) {
        const pkey = `profile:${p.profile_url.replace(/\/$/, '').toLowerCase()}`;
        entities.push({ type: 'profile', value: p.profile_url, label: `Gravatar: ${p.display_name || ''}`.trim(), rel: 'has account', props: { site: 'Gravatar', display_name: p.display_name, bio: p.description, job_title: p.job_title } });
        if (looksLikeName(p.display_name)) entities.push({ type: 'person', value: p.display_name, rel: 'name on profile', from: pkey });
        if (p.location) entities.push({ type: 'location', value: p.location, rel: 'located in', from: pkey });
        if (p.company) entities.push({ type: 'organization', value: p.company, rel: 'works at', from: pkey });
        for (const a of p.verified_accounts || []) if (a.url) entities.push({ type: 'profile', value: a.url, label: `${a.service_label}`, rel: 'verified account', from: pkey, props: { site: a.service_label } });
      }
      return { entities };
    },
  },
  {
    id: 'email_github', name: 'GitHub accounts & commits by e-mail', group: 'People', source: 'GitHub',
    description: 'Finds GitHub users who list this e-mail and authors of commits made with it.',
    inputs: ['email'],
    async run({ value }, ctx) {
      const entities = [];
      const notes = [];
      const [users, commits] = await Promise.allSettled([
        ctx.http.json(`https://api.github.com/search/users?q=${enc(`${value} in:email`)}`, { headers: gh(ctx) }),
        ctx.http.json(`https://api.github.com/search/commits?q=${enc(`author-email:${value}`)}&per_page=20`, { headers: gh(ctx) }),
      ]);
      if (users.status === 'rejected' && commits.status === 'rejected') throw users.reason;
      const logins = new Map();
      for (const u of users.value?.items || []) logins.set(u.login, 'lists this email');
      const names = new Set();
      for (const c of commits.value?.items || []) {
        if (c.author?.login && !logins.has(c.author.login)) logins.set(c.author.login, 'commits with this email');
        if (c.commit?.author?.name) names.add(c.commit.author.name);
      }
      for (const [login, why] of [...logins].slice(0, 5)) {
        entities.push({ type: 'profile', value: `https://github.com/${login}`, label: `GitHub: ${login}`, rel: why, props: { site: 'GitHub', username: login } });
        entities.push({ type: 'username', value: login, rel: 'handle', from: `profile:https://github.com/${login.toLowerCase()}` });
      }
      [...names].filter(looksLikeName).slice(0, 3).forEach((n) => entities.push({ type: 'person', value: n, rel: 'commit author name' }));
      if (commits.value?.total_count) notes.push(`${commits.value.total_count} public commits use this address.`);
      return { entities, notes };
    },
  },
  {
    id: 'person_github', name: 'GitHub accounts by name', group: 'People', source: 'GitHub', auto: false,
    description: 'Accounts whose profile name matches. Candidates only: names are not unique.',
    inputs: ['person', 'organization'],
    async run({ type, value }, ctx) {
      const q = type === 'person' ? `fullname:"${value}"` : `"${value}" in:name type:org`;
      const j = await ctx.http.json(`https://api.github.com/search/users?q=${enc(q)}&per_page=5`, { headers: gh(ctx) });
      return { entities: (j?.items || []).map((u) => ({ type: 'profile', value: u.html_url, label: `GitHub: ${u.login}`, rel: 'possible account', props: { site: 'GitHub', username: u.login, confidence: 'candidate' } })) };
    },
  },
  {
    id: 'person_usernames', name: 'Guess usernames', group: 'People', source: 'local', local: true, auto: false,
    description: 'Generates likely handles from a name (jdoe, john.doe, ...) to feed the username search.',
    inputs: ['person'],
    async run({ value }) {
      const parts = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z0-9]/g, '')).filter(Boolean);
      if (parts.length < 2) return { entities: [] };
      const f = parts[0];
      const l = parts[parts.length - 1];
      const cands = [`${f}${l}`, `${f}.${l}`, `${f[0]}${l}`, `${f}_${l}`, `${f}${l[0]}`, `${l}${f}`, `${f}-${l}`];
      return { entities: [...new Set(cands)].map((c) => ({ type: 'username', value: c, rel: 'possible username', props: { confidence: 'guess' } })) };
    },
  },
  {
    id: 'phone_info', name: 'Phone country', group: 'People', source: 'local', local: true,
    description: 'Country of an international phone number, from its calling code.',
    inputs: ['phone'],
    async run({ value }) {
      const digits = value.replace(/^\+|^00/, '').replace(/\D/g, '');
      if (!/^(\+|00)/.test(value)) return { entities: [], notes: ['Not in international format (+country code), cannot tell the country.'] };
      for (const len of [3, 2, 1]) {
        const c = CALLING_CODES[digits.slice(0, len)];
        if (c) return { entities: [{ type: 'location', value: c, rel: 'country code' }], props: { calling_code: `+${digits.slice(0, len)}` } };
      }
      return { entities: [] };
    },
  },
];
