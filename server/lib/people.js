// Finding people (and the contact details that belong to them) on web pages.
import { socialProfile, findEmails } from './extract.js';

const STOP = new Set(('about contact contacts our us team teams privacy policy terms conditions services service home news read more learn get the and for with ' +
  'new your you we who what why how where meet join follow latest blog press media careers jobs products product solutions company legal cookie cookies ' +
  'settings support help login sign up in out all rights reserved copyright welcome quick links menu search subscribe newsletter events resources case ' +
  'studies study customers partners pricing features overview mission vision values history office offices headquarters address email phone call send ' +
  'message view open close next previous back top share download free demo request quote book now today board directors management leadership staff ' +
  'people members member advisory executive general information social follow street road avenue suite floor building city united states kingdom ' +
  'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ' +
  'frequently asked questions related posts recent articles featured stories site map data protection web design digital marketing customer success ' +
  'human resources public relations click here find out').split(' '));
const PARTICLE = /^(de|del|della|di|da|dos|van|von|der|den|la|le|du|bin|ibn|al|el|ter|ten|zu|y)$/i;
const TITLE = /^(dr|prof|professor|mr|mrs|ms|miss|mx|sir|dame|ing|dipl|mag|rev|hon|herr|frau|mme|m|sr|sra)\.?$/i;
const ROLE = /\b(ceo|cto|cfo|coo|cmo|cio|ciso|chief|founder|co-?founder|director|manager|head of|president|vice|vp|partner|principal|engineer|developer|designer|architect|professor|lecturer|researcher|scientist|attorney|lawyer|counsel|doctor|physician|nurse|officer|lead|consultant|analyst|editor|journalist|reporter|writer|owner|chair|chairman|chairwoman|secretary|treasurer|advisor|adviser|associate|assistant|specialist|coordinator|administrator|executive|accountant|recruiter|sales|marketing|geschäftsführer|geschäftsführerin|leiter|leiterin|inhaber|inhaberin|vorstand|directeur|directrice|gérant|responsable|gerente|direttore)\b/i;
const NAME_CLASS = /name|person|member|author|staff|team|people|profile|employee|speaker|founder|bio|vcard/i;
export const PEOPLE_PAGE = /team|people|staff|about|contact|impressum|imprint|leadership|management|board|founder|who-we-are|company|kontakt|ueber-uns|uber-uns|equipo|equipe|nosotros|partners|attorneys|lawyers|doctors|faculty|directory|authors?|experts|advisors|crew|employees|mitarbeiter/i;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&[a-z]+;/g, ' ');
const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "Dr. Jane van Doe, PhD" → "Jane van Doe"; returns '' when the text does not look like a person's name. */
export function personName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim().split(/\s*[,|–—(]\s*/)[0];
  if (s.length < 5 || s.length > 45 || /[\d@:/!?&]/.test(s) || ROLE.test(s)) return '';
  let tokens = s.split(' ');
  while (tokens.length && TITLE.test(tokens[0])) tokens.shift();
  if (tokens.length < 2 || tokens.length > 4) return '';
  let real = 0;
  for (const t of tokens) {
    if (PARTICLE.test(t)) continue;
    if (/^\p{Lu}\.$/u.test(t)) continue; // middle initial
    if (!/^\p{Lu}[\p{Ll}'’-]+(\p{Lu}[\p{Ll}]+)?$/u.test(t)) return '';
    if (STOP.has(t.toLowerCase())) return '';
    real++;
  }
  return real >= 2 ? tokens.join(' ') : '';
}

function contactsIn(html, base) {
  const out = { emails: [], phones: [], profiles: [] };
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decode(m[1]).trim();
    if (/^mailto:/i.test(href)) { try { out.emails.push(decodeURIComponent(href.slice(7).split('?')[0]).toLowerCase()); } catch { /* bad escape */ } }
    else if (/^tel:/i.test(href)) out.phones.push(decodeURIComponent(href.slice(4)).trim());
    else { let u; try { u = new URL(href, base).href; } catch { continue; } const sp = socialProfile(u); if (sp) out.profiles.push(sp); }
  }
  out.emails.push(...findEmails(textOf(html)));
  out.emails = [...new Set(out.emails)].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e));
  out.phones = [...new Set(out.phones)];
  out.profiles = [...new Map(out.profiles.map((p) => [p.url.toLowerCase(), p])).values()];
  return out;
}

const imageIn = (html, base) => {
  for (const m of html.matchAll(/<img\b[^>]*?\b(?:data-src|src)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (/logo|icon|sprite|placeholder|spacer|\.svg|^data:/i.test(m[0])) continue;
    try { return new URL(decode(m[1]), base).href; } catch { /* bad URL */ }
  }
  return null;
};

/** People described on one page: [{ name, role, emails, phones, profiles, image, sure }]. */
export function extractPeople(html, pageUrl) {
  const people = new Map();
  const put = (name, data) => {
    const k = fold(name);
    const p = people.get(k) || { name, role: '', emails: [], phones: [], profiles: [], image: null, sure: false };
    p.role ||= data.role || '';
    p.image ||= data.image || null;
    p.sure ||= !!data.sure;
    p.emails.push(...(data.emails || []));
    p.phones.push(...(data.phones || []));
    p.profiles.push(...(data.profiles || []));
    people.set(k, p);
  };

  // 1. structured data
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (/\bPerson\b/.test([].concat(n['@type'] || []).join(' ')) && typeof n.name === 'string' && personName(n.name)) {
        const img = typeof n.image === 'string' ? n.image : n.image?.url;
        put(personName(n.name), { sure: true, role: typeof n.jobTitle === 'string' ? n.jobTitle.slice(0, 80) : '',
          emails: typeof n.email === 'string' ? [n.email.replace(/^mailto:/, '').toLowerCase()] : [],
          phones: typeof n.telephone === 'string' ? [n.telephone] : [],
          profiles: [].concat(n.sameAs || [], n.url || []).map((u) => typeof u === 'string' && socialProfile(u)).filter(Boolean),
          image: typeof img === 'string' ? img : null });
      }
      Object.values(n).forEach((v) => typeof v === 'object' && walk(v));
    };
    try { walk(JSON.parse(m[1])); } catch { /* malformed JSON-LD */ }
  }

  // 2. visible "cards": a name in a heading (or an element whose class says it is a name) followed by details
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ');
  const cands = [];
  // two passes, so that a small container never swallows the heading inside it
  const scan = (re, heading) => {
    for (const m of body.matchAll(re)) {
      const hinted = NAME_CLASS.test(m[2].match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || '');
      if (!heading && (!hinted || /<(div|p|li|h[1-6]|ul|table)\b/i.test(m[3]))) continue;
      const name = personName(textOf(m[3]));
      if (name) cands.push({ name, start: m.index, end: m.index + m[0].length, hinted, heading: /^h[1-6]$/i.test(m[1]) });
    }
  };
  scan(/<(h[1-6]|strong|b|dt|figcaption)\b([^>]*)>([\s\S]{2,240}?)<\/\1>/gi, true);
  scan(/<(span|div|p|a|li|td)\b([^>]*)>([\s\S]{2,160}?)<\/\1>/gi, false);
  cands.sort((x, y) => x.start - y.start);
  for (let i = cands.length - 1; i > 0; i--) if (cands[i].start < cands[i - 1].end) cands.splice(i, 1); // nested duplicates
  const onPeoplePage = PEOPLE_PAGE.test(new URL(pageUrl).pathname);
  let portraitFirst = true;
  cands.forEach((c, i) => {
    const next = cands.slice(i + 1).find((n) => fold(n.name) !== fold(c.name));
    // the card ends at the next person, the next heading of the same or a higher level, or the page footer
    const level = c.heading ? +body[c.start + 2] : 7;
    const stops = [next ? next.start : body.length, c.end + 1800];
    for (const m of body.slice(c.end, c.end + 1800).matchAll(/<(?:h([1-6])|(footer))\b/gi)) if (m[2] || +m[1] <= level) { stops.push(c.end + m.index); break; }
    const seg = body.slice(c.end, Math.min(...stops));
    const prev = cands[i - 1];
    const before = body.slice(Math.max(prev ? prev.end : 0, c.start - 700), c.start);
    const contacts = contactsIn(seg, pageUrl);
    const pieces = seg.slice(0, 600).replace(/<[^>]+>/g, '\n').split('\n').map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const role = pieces.slice(0, 4).find((t) => t.length >= 3 && t.length <= 70 && ROLE.test(t)) || '';
    const beforeImgs = [...before.matchAll(/<img\b[^>]*>/gi)];
    const imgBefore = beforeImgs.length ? imageIn(beforeImgs[beforeImgs.length - 1][0], pageUrl) : null;
    // cards put the portrait either above or below the name; the first card tells which
    if (i === 0) portraitFirst = !!imgBefore;
    const image = portraitFirst ? imgBefore : imageIn(seg.slice(0, 500), pageUrl);
    const corroborated = !!role || contacts.emails.length || contacts.phones.length || contacts.profiles.length || (c.hinted && onPeoplePage);
    if (!corroborated && !(onPeoplePage && (c.heading || c.hinted))) return;
    // a lone e-mail far from the name is more likely the site's general address than this person's
    if (!role && !c.hinted && contacts.emails.length > 2) contacts.emails = [];
    put(c.name, { ...contacts, role, image: role || c.hinted || onPeoplePage ? image : null, sure: corroborated });
  });

  return [...people.values()].map((p) => ({ ...p, emails: [...new Set(p.emails)].slice(0, 3), phones: [...new Set(p.phones)].slice(0, 3),
    profiles: [...new Map(p.profiles.map((x) => [x.url.toLowerCase(), x])).values()].slice(0, 5) }));
}

/** Does this address look like it belongs to this person (jane.doe@, jdoe@, doe@ ...)? Returns 0–2 (2 = strong). */
export function emailNameMatch(email, name) {
  const local = fold(email.split('@')[0]).replace(/[^a-z]/g, '');
  const t = fold(name).split(/\s+/).map((x) => x.replace(/[^a-z]/g, '')).filter((x) => x && !PARTICLE.test(x));
  if (t.length < 2 || local.length < 3) return 0;
  const f = t[0], l = t[t.length - 1];
  if ([f + l, l + f, f[0] + l, f + l[0], l + f[0]].includes(local)) return 2;
  return local === f || local === l ? 1 : 0;
}
