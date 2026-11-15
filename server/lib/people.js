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
  'human resources public relations click here find out ' +
  // German, French, Spanish, Italian and Dutch page vocabulary
  'unser unsere unserem unseren unserer ihr ihre ihren der die das dem den ein eine einen wir sie uns über uber mehr alle neue neues neuer aktuelles ' +
  'ziele ziel werte leitbild geschichte standort standorte kontakt impressum datenschutz karriere produkte produkt leistungen leistung lösungen ' +
  'unternehmen firma willkommen erfahren weiterlesen startseite anfahrt öffnungszeiten ansprechpartner geschäftsführung geschäftsleitung vorstand ' +
  'aufsichtsrat mitarbeiter kunden partner presse medien nachrichten veranstaltungen termine downloads qualität nachhaltigkeit verantwortung ' +
  'zukunft innovation forschung entwicklung herstellung vertrieb logistik einkauf verkauf buchhaltung personal verwaltung zentrale zum zur vom im ' +
  'notre nos votre vos le les une des du nous vous qui sommes équipe equipe propos accueil actualités contactez mentions légales politique société ' +
  'el los las nuestro nuestra nuestros nuestras quienes somos sobre inicio noticias contacto aviso empresa equipo servicios productos ' +
  'il lo gli nostro nostra nostri chi siamo azienda contatti notizie servizi prodotti squadra ' +
  'ons onze over wij het een nieuws diensten producten bedrijf').split(' ').filter(Boolean));
const COMPANY = /^(gmbh|ag|kg|ohg|ug|inc|ltd|llc|llp|plc|corp|corporation|company|co|group|gruppe|holding|holdings|pharma|pharmaceuticals|labs|laboratories|solutions|systems|technologies|technology|software|consulting|partners|associates|industries|international|global|bank|capital|ventures|media|studio|studios|services|foundation|institute|university|sa|sas|sarl|srl|spa|bv|nv|ab|oy|as|aps|kft|sro)$/i;
const FIRST_NAMES = new Set(('aaron abdul abigail adam adrian adriana agnes ahmed aisha alan albert alberto alejandro alessandro alex alexander alexandra alexis alfred ali alice alicia alina ' +
  'alison amanda amber amelia amir amy ana anastasia andre andrea andreas andrew andrzej angela angelika anita ann anna anne annette anthony anton antonia antonio ' +
  'ariane arthur ashley astrid barbara bastian beate beatrice ben benedikt benjamin bernard bernd bernhard bettina bianca bill birgit bob boris brandon brenda brian ' +
  'brigitte bruno camille carina carl carla carlos carmen carol carolina caroline catherine cedric charles charlotte chiara chloe chris christa christian christiane ' +
  'christina christine christoph christopher clara claire claudia claus clemens colin connor cornelia craig cristina cynthia daniel daniela danielle david deborah ' +
  'denis denise dennis diana diane diego dieter dirk dominik donald donna doris dorothea douglas edith eduardo edward elena elias elisabeth elizabeth elke ellen emil ' +
  'emily emma emanuel eric erik erika ernst erwin esther eva evelyn fabian felix ferdinand fernando florian frances francesca francesco francis francisco frank franz ' +
  'frederic friedrich gabriel gabriela gabriele gary georg george gerald gerhard gerda gert gisela giulia giuseppe gloria gordon grace greg gregor gregory gudrun ' +
  'guido gunter günter günther gustav hannah hannes hans harald harry heather heidi heike heinrich heinz helen helena helene helga helmut henry herbert hermann hugo ' +
  'ian ines ingrid irene iris isabel isabella isabelle ivan jack jacob jacqueline jakob james jan jana jane janet janine jasmin jason javier jean jeff jeffrey jennifer ' +
  'jens jeremy jessica jim joachim joan joanna joe johann johanna johannes john jon jonas jonathan jorge jose josef joseph joshua juan judith julia julian juliane ' +
  'julie jürgen justin jutta karen karin karl karolina katarina katharina katherine kathrin katja katrin kelly ken kenneth kerstin kevin kim klaus konrad kristin ' +
  'kurt lars laura lauren laurent lea lena leo leon leonie lisa lorenz louis louise luca lucas lucia lucy ludwig luis luisa lukas lydia magdalena manfred manuel ' +
  'manuela marc marcel marco marcus margaret margit maria marie marina mario marion mark markus marlene martha martin martina mary mathias matt matthew matthias ' +
  'max maximilian melanie melissa michael michaela michel michele michelle miguel mike mohamed mohammed monica monika moritz nadine nancy natalia natalie nathan ' +
  'nicholas nick nicolas nicole nikolaus nina noah norbert oliver olivia olga oscar oskar otto pablo pamela patricia patrick paul paula pedro peter petra philip ' +
  'philipp philippe pia pierre rachel rafael rainer ralf ralph ramona raphael rebecca regina reinhard renate rene richard rita robert roberto robin roger roland ' +
  'rolf roman ronald rosa rudolf ruth ryan sabine sabrina samantha samuel sandra sara sarah sascha scott sean sebastian sergio sharon silke silvia simon simone ' +
  'sofia sonja sophia sophie stefan stefanie steffen stephan stephanie stephen steve steven susan susanne sven svenja sylvia tanja teresa theresa thomas thorsten ' +
  'tim timo timothy tina tobias tom tomas tony ulrich ulrike ursula uwe valentina valerie vanessa vera verena veronika victor victoria viktor vincent volker walter ' +
  'werner wilhelm william wolfgang xavier yvonne zoe raj priya arjun rahul amit anil sunita wei li ming chen hiroshi yuki kenji akira fatima omar hassan yusuf ' +
  'ibrahim mustafa mehmet ayse elif emre olga dmitri sergei natasha tatiana igor pavel jan piotr krzysztof agnieszka katarzyna tomasz marek ewa maría josé jesús ' +
  'joão andré zoltán istván lászló gábor éva').split(' '));
/** Is the first word a given name we recognise? Used only as supporting evidence, never to reject. */
export const knownFirstName = (name) => FIRST_NAMES.has(String(name).trim().split(/\s+/)[0].toLowerCase());
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
    if (STOP.has(t.toLowerCase()) || COMPANY.test(t) || t.length > 16) return '';
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
    const role = pieces.slice(0, 3).find((t) => t.length >= 3 && t.length <= 60 && ROLE.test(t)) || '';
    const beforeImgs = [...before.matchAll(/<img\b[^>]*>/gi)];
    const imgBefore = beforeImgs.length ? imageIn(beforeImgs[beforeImgs.length - 1][0], pageUrl) : null;
    // cards put the portrait either above or below the name; the first card tells which
    if (i === 0) portraitFirst = !!imgBefore;
    const image = portraitFirst ? imgBefore : imageIn(seg.slice(0, 500), pageUrl);
    // Evidence that this heading is a person and not a section title: a recognisable given name or a "name"
    // class, a job title right below it, or an address that spells the name.
    const nameish = c.hinted || knownFirstName(c.name);
    const ownEmail = contacts.emails.some((e) => emailNameMatch(e, c.name));
    const hasContact = contacts.emails.length || contacts.phones.length || contacts.profiles.length;
    const corroborated = ownEmail || (nameish && (!!role || hasContact || onPeoplePage));
    if (!corroborated && !(role && (hasContact || onPeoplePage)) && !(nameish && c.heading)) return;
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
