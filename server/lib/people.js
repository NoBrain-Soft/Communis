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
  'human resources public relations click here find out senior junior deputy interim acting staff employment verification membership receptionist ' +
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
const COMPANY = /^(privatstiftung|stiftung|verein|verlag|zeitung|medien|gmbh|ag|kg|ohg|ug|inc|ltd|llc|llp|plc|corp|corporation|company|co|group|gruppe|holding|holdings|pharma|pharmaceuticals|labs|laboratories|solutions|systems|technologies|technology|software|consulting|partners|associates|industries|international|global|bank|capital|ventures|media|studio|studios|services|foundation|institute|university|sa|sas|sarl|srl|spa|bv|nv|ab|oy|as|aps|kft|sro)$/i;
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
// honorifics and academic titles that precede a name (German/Austrian style included: Mag.a, Dr.in, DI (FH), KommR ...)
const TITLE = /^(?:(?:univ|ao|o|priv|hon|ass)\.?-?)?(dr|ddr|dddr|prof|professor|doz|mr|mrs|ms|miss|mx|sir|dame|ing|dipl|di|dkfm|mag|mmag|rev|hon|herr|frau|mme|m|sr|sra|kr|kommr|tzt|vet|med|iur|jur|rer|nat|phil|techn|pharm|dipl\.?-?(?:ing|kfm|kffr|bw|vw|päd|tzt|psych|inf))(?:\.?(?:a|in|ª))?\.?$|^\((?:fh|ba)\)$/i;
const POSTNOMINAL = /^(mba|emba|msc|m\.sc\.?|bsc|b\.sc\.?|ma|m\.a\.?|ba|b\.a\.?|phd|ph\.d\.?|ll\.?m\.?|mas|mbl|mim|cfa|cpa|md|meng|beng|bakk\.?|akad\.?)$/i;
const ROLE = /\b(ceo|cto|cfo|coo|cmo|cio|ciso|chief|founder|co-?founder|director|manager|head of|president|vice|vp|partner|principal|engineer|developer|designer|architect|professor|lecturer|researcher|scientist|attorney|lawyer|counsel|doctor|physician|nurse|officer|lead|consultant|analyst|editor|journalist|reporter|writer|owner|chair|chairman|chairwoman|secretary|treasurer|advisor|adviser|associate|assistant|specialist|coordinator|administrator|executive|accountant|recruiter|sales|marketing|geschäftsführer|geschäftsführerin|leiter|leiterin|inhaber|inhaberin|vorstand|directeur|directrice|gérant|responsable|gerente|direttore|advocate|technologist|activist|organizer|organiser|strategist|paralegal|producer|curator|librarian|teacher|fellow|intern|trainee|receptionist|governor|mayor|minister|chancellor|senator|councillor|councilor|commissioner|ambassador|spokesperson|spokesman|spokeswoman|shareholder|landeshauptmann|landeshauptfrau|landesrat|landesrätin|bürgermeister|bürgermeisterin|stadtrat|stadträtin|bundeskanzler|bundeskanzlerin|abgeordnete|abgeordneter|eigentümer|eigentümerin|gründer|gründerin|communications|key account|außendienst|innendienst|qualitätssicherung|regulatory affairs|medical affairs|compliance|controlling|hr)\b|(leiter|leiterin|leitung|führer|führerin|managerin?|direktor|direktorin|berater|beraterin|betreuer|betreuerin|assistenz|assistent|referent|beauftragte|prokurist|sprecher|redakteur|tierarzt|tierärztin|apotheker|techniker|entwickler|ingenieur|sachbearbeiter|buchhalter|sekretär|pharmazeut|wissenschaftler|obmann|obfrau|präsident|vorsitzende)/i;
const NAME_CLASS = /name|person|member|author|speaker|founder|vcard/i;
// classes that mark something else inside a person card (the job title, the bio, the photo ...)
const NOT_NAME_CLASS = /title|role|position|job|desc|bio|mail|phone|photo|img|image|text|body|content|list|wrapper|container|row|grid|section|username|company|function/i;
const ROLE_CLASS = /(?:^|[\s_-])(?:job|position|role|function|funktion|profile-title|jobtitle|job-title|titel|subtitle|designation|occupation)(?:$|[\s_-])|profile-title|job-?title/i;
const PEOPLE_PATH = /\/(?:staff|team|people|person|persons|profile|profiles|author|authors|mitarbeiter|about\/[a-z-]*(?:staff|team|board|people)|board|leadership|experts|members|bios?)\/([a-z0-9][a-z0-9._%-]{2,60})\/?$/i;
export const NEWS_PAGE = /press|presse|news|blog|aktuell|neuigkeit|updates|stories|magazin|medien|media|journal|meldung|mitteilung|artikel|article/i;
// pages that list the organisation's own people (as opposed to history or news pages that talk about guests)
const STAFF_PAGE = /impressum|imprint|team|staff|mitarbeiter|kontakt|contact|people|leadership|management|board|redaktion|ansprechpartner/i;
export const PEOPLE_PAGE = /team|people|staff|about|contact|impressum|imprint|leadership|management|board|founder|who-we-are|company|kontakt|ueber-uns|uber-uns|equipo|equipe|nosotros|partners|attorneys|lawyers|doctors|faculty|directory|authors?|experts|advisors|crew|employees|mitarbeiter/i;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&[a-z]+;/g, ' ');
const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "Dr. Jane van Doe, PhD" → "Jane van Doe"; returns '' when the text does not look like a person's name. */
const TRAILING = /^(redaktion|verkauf|anzeigen|anzeigenverkauf|grafik|sekretariat|leitung|vertrieb|marketing|produktion|buchhaltung|verwaltung|assistenz|cv|team|office|sales|editor|editorial|support)$/i;

export function parseName(raw) {
  const none = { name: '', title: '' };
  const fh = String(raw || '').match(/\((FH|BA)\)/i);
  const parts = String(raw || '').replace(/\((FH|BA)\)/gi, ' ').replace(/\s+/g, ' ').trim().split(/\s*[,|–—(]\s*/);
  const s = parts[0];
  if (s.length < 5 || s.length > 60 || /[\d@:/!?&]/.test(s)) return none;
  const tokens = s.split(' ');
  const titles = [];
  while (tokens.length && TITLE.test(tokens[0])) titles.push(tokens.shift());
  while (tokens.length > 2 && POSTNOMINAL.test(tokens[tokens.length - 1])) titles.push(tokens.pop());
  for (const extra of parts.slice(1)) if (POSTNOMINAL.test(extra.replace(/\)$/, '').trim())) titles.push(extra.replace(/\)$/, '').trim());
  // "Birgit Leitner Redaktion": a department or section word after the name is not part of it
  while (tokens.length > 2 && (STOP.has(tokens[tokens.length - 1].toLowerCase()) || TRAILING.test(tokens[tokens.length - 1]))) tokens.pop();
  const rest = tokens.join(' ');
  if (tokens.length < 2 || tokens.length > 4 || rest.length > 45 || ROLE.test(rest)) return none;
  let real = 0;
  for (const t of tokens) {
    if (PARTICLE.test(t)) continue;
    if (/^\p{Lu}\.$/u.test(t)) continue; // middle initial
    if (!/^\p{Lu}[\p{Ll}'’-]+(\p{Lu}[\p{Ll}]+)?$/u.test(t)) return none;
    if (STOP.has(t.toLowerCase()) || COMPANY.test(t.replace(/['’]s$/, '')) || /['’]s$/.test(t) || t.length > 16) return none;
    real++;
  }
  const title = titles.join(' ');
  return real >= 2 ? { name: rest, title: fh && title ? title.replace(/^(\S+)/, `$1 (${fh[1].toUpperCase()})`) : title } : none;
}

/** "Dr. Jane van Doe, PhD" → "Jane van Doe"; returns '' when the text does not look like a person's name. */
export const personName = (raw) => parseName(raw).name;

const NOT_TITLE = '(?!(?:Dr|Mag|MMag|DDr|Prof|Doz|Ing|DI|Dipl|Dkfm|KR|KommR|Tzt|Mr|Mrs|Ms|Sir|CEO|CFO|COO|CTO)\\b)';
const NAME_RE = `${NOT_TITLE}\\p{Lu}[\\p{Ll}'’]+(?:-\\p{Lu}[\\p{Ll}]+)*(?:[ \\u00a0]+(?:(?:de|del|van|von|der|den|la|le|du|zu|di|da)[ \\u00a0]+)*${NOT_TITLE}\\p{Lu}[\\p{Ll}'’]+(?:-\\p{Lu}[\\p{Ll}]+)*){1,2}(?!['’]s\\b)`;
const TITLE_RE = '(?:(?:Univ\\.-?|Priv\\.-?|Ao\\.\\s?|Hon\\.-?)?Prof\\.|Doz\\.|MMag\\.|Mag\\.(?:a|ª)?(?:\\s?(?:pharm|iur|phil|theol|arch|art|rer\\.\\s?(?:nat|soc|oec))\\.)?|DDr\\.|Dr\\.(?:in)?(?:\\s(?:med|iur|jur|rer|nat|phil|techn|vet)\\.){0,2}|Dipl\\.-?(?:Ing|Kfm|Kffr|Bw|Vw|Tzt|Inf)\\.?(?:\\s?\\(FH\\))?|DI(?:\\s?\\(FH\\))?|Dkfm\\.|Ing\\.|KR|KommR|Tzt\\.)';
const POST_RE = '(?:,?\\s*(?:MBA|EMBA|MSc|M\\.Sc\\.|BSc|B\\.Sc\\.|MA|BA|PhD|Ph\\.D\\.|LL\\.M\\.|MAS|MBL|MIM|CFA|Bakk\\.))*';
const LABELS = 'Geschäftsführ(?:er|erin|ung|ende[rn]?)(?:\\s+Gesellschafter(?:in)?)?|Geschäftsleitung|Vorstand(?:svorsitzende[r]?|smitglied(?:er)?)?|Inhaber(?:in)?|Prokurist(?:in|en)?|Vertretungsberechtigt(?:e[rn]?)?(?:\\s+Geschäftsführer(?:in)?)?|(?:Inhaltlich\\s+)?[Vv]erantwortlich(?:e[r]?)?(?:\\s+(?:für\\s+den\\s+Inhalt|im\\s+Sinne[^:\\n]{0,40}))?|Aufsichtsrat(?:svorsitzende[r]?)?|Gesellschafter(?:in)?|Herausgeber(?:in)?|Chefredakt(?:eur|eurin|ion)|Redaktion|Ansprechpartner(?:in)?|Datenschutzbeauftragte[r]?|Obmann|Obfrau|Präsident(?:in)?|CEO|CFO|CTO|COO|Managing\\s+Directors?|Directors?|Owner|Founder|Editor(?:-in-[Cc]hief)?|Publisher|Contact\\s+person|Data\\s+protection\\s+officer|Represented\\s+by|Vertreten\\s+durch|Gérant|Directeur(?:\\s+de\\s+la\\s+publication)?';

/** Tidy a job title: a degree in front of it ("MA / Head of Sales") belongs to the academic title, not the role. */
function splitRole(role) {
  const lead = String(role || '').trim().match(/^((?:MBA|EMBA|MSc|BSc|MA|BA|PhD|LL\.M\.|MAS|MBL)(?:\s*,\s*(?:MBA|MSc|BSc|MA|BA|PhD))*)(?:\s*[\/|–,-]\s*|\s+)(?:HSG\s+)?(.+)$/);
  return lead ? { role: lead[2].trim(), degree: lead[1] } : { role: String(role || '').trim(), degree: '' };
}

/** A role must describe this person: reject fragments that start mid-sentence or already name the next person. */
function ownRole(role) {
  return !CONNECTOR.test(role.split(/\s+/)[0]) && !new RegExp(TITLE_RE, 'u').test(role) && ![...role.matchAll(new RegExp(NAME_RE, 'gu'))].some((x) => parseName(x[0]).name && knownFirstName(x[0]));
}

/** HTML to text that keeps one line per block element, so "Label: value" pairs stay together. */
export function blockText(html) {
  return decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/td|\/tr|\/dd|\/dt|\/section|\/address)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/**
 * People named in running text rather than in "cards": imprint lines ("Geschäftsführer: Mag. Jane Doe, John Roe"),
 * names carrying an academic title, and "Name, Role" / "Name (Role)" pairs.
 */
export function peopleInText(text, own = [], staffPage = true) {
  const ownWords = own.flatMap((o) => fold(o).split(/[^a-z0-9]+/)).filter((w) => w.length >= 5);
  const found = new Map();
  const put = (raw, role, sure, guest = false) => {
    const { name, title } = parseName(raw);
    if (!name) return;
    const k = fold(name);
    const p = found.get(k) || { name, title: '', role: '', sure: false, staff: false };
    p.title ||= title; p.role ||= role || ''; p.sure ||= sure; p.staff ||= !guest;
    found.set(k, p);
  };
  for (const m of text.matchAll(new RegExp(`(?:^|[\\n(;])\\s*(${LABELS})\\s*(?::|\\n)\\s*([^\\n]{4,200})`, 'gu'))) {
    const role = m[1].replace(/\s+/g, ' ').replace(/^Vertreten durch$|^Represented by$/i, 'Representative');
    for (const piece of m[2].split(/\s*(?:;|\/|&|\bund\b|\band\b|\bsowie\b|,(?!\s*(?:MBA|MSc|BSc|MA|BA|PhD|LL|MAS|MBL)))\s*/)) put(piece, role, true);
  }
  for (const m of text.matchAll(new RegExp(`(${NAME_RE})(${POST_RE})\\s*(?:,|\\(|–|—| - |\\|)\\s*([^\\n,;()|]{3,60})`, 'gu'))) {
    const role = m[3].trim();
    // in prose "X, the mayor of Y Dr. Z" the words after the comma describe the next person, not X
    const clean = ownRole(role);
    if (clean && ROLE.test(role) && !parseName(role).name && knownFirstName(m[1])) {
      // "Peter Norvig, director of search quality at Google" is a guest (a testimonial, a quote), not staff
      const elsewhere = /\b(?:at|of|for|with|bei|von|der|des|@)\s+(?:the\s+)?\p{Lu}/u.test(role) || /\b(?:at|of|for|with|bei|von)$/i.test(role);
      // in a caption or article, "Name (Role)" says nothing about who the person works for unless the role names
      // this organisation; on a team or imprint page it does
      const names = fold(role).split(/[^a-z0-9]+/).some((w) => ownWords.includes(w));
      put(`${m[1]}${m[2] || ''}`, role.replace(/[.:]$/, '').replace(/\s+(?:at|of|for|with|bei|von|the)$/i, ''), true, names ? false : (elsewhere || !staffPage));
    }
  }
  return [...found.values()];
}

const CONNECTOR = /^(the|a|an|and|und|der|die|das|dem|den|des|sowie|with|mit|by|von|vom|as|als|our|unser|unsere|unserem|unseren|its|their|his|her|ihr|ihre|sein|seine|new|neue|neuer|former|ehemalige|ehemaliger|to|for|zu|für|at|in|im|on|bei|from|aus|while|said|says|sagt|sagte|so|laut|according|herr|frau|mr|mrs|ms)$/i;

/**
 * People named in prose: "the Upper Austrian Governor Mag. Thomas Stelzer", "Acme CEO Jane Doe".
 * A name counts when it carries an academic title or is introduced by an office or job word. `own` lists the
 * names of the organisation that runs the site; a person introduced with one of those ("Acme CEO ...") is
 * affiliated with it, anybody else is merely mentioned.
 */
export function mentionsInText(text, own = []) {
  const out = new Map();
  const ownRe = own.filter((o) => o.length >= 3).map((o) => fold(o).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  for (const m of text.matchAll(new RegExp(`((?:${TITLE_RE}\\s*){0,4})(${NAME_RE})(${POST_RE})`, 'gu'))) {
    const { name, title } = parseName(`${m[1]} ${m[2]}${m[3] || ''}`);
    if (!name) continue;
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const before = text.slice(Math.max(lineStart, m.index - 70), m.index).split(/[,.;:()!?„“”"»«]/).pop().trim().split(/\s+/).filter(Boolean);
    let from = before.length;
    while (from > 0 && before.length - from < 6 && !CONNECTOR.test(before[from - 1])) from--;
    let descriptor = before.slice(from).join(' ');
    if (!ROLE.test(descriptor)) descriptor = '';
    if (!title && !(descriptor && knownFirstName(name))) continue;
    const folded = fold(descriptor).replace(/[^a-z0-9]+/g, ' ');
    const ownName = ownRe.find((o) => folded.includes(o) || o.split(' ').some((w) => w.length >= 5 && folded.split(' ').includes(w)));
    let role = descriptor;
    if (ownName) role = descriptor.split(/\s+/).filter((w) => !ownName.split(' ').includes(fold(w).replace(/[^a-z0-9]/g, ''))).join(' ');
    const end = text.indexOf('\n', m.index);
    const line = text.slice(lineStart, end < 0 ? text.length : end);
    const at = m.index - lineStart;
    const context = `${at > 110 ? '…' : ''}${line.slice(Math.max(0, at - 110), at + m[0].length + 110).trim()}${line.length > at + m[0].length + 110 ? '…' : ''}`;
    const k = fold(name);
    const p = out.get(k) || { name, title: '', role: '', own: false, context };
    p.title ||= title; p.role ||= role; p.own ||= !!ownName;
    out.set(k, p);
  }
  return [...out.values()];
}

const DATE_RE = '(?:\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}|(?:\\d{1,2}\\.?\\s)?(?:Jan|Feb|Mar|Mär|Apr|May|Mai|Jun|Jul|Aug|Sep|Oct|Okt|Nov|Dec|Dez)[a-zä]*\\.?\\s\\d{1,2}?,?\\s?\\d{4})';
const isoDate = (d) => {
  let m = d.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = d.match(/^\d{4}-\d{2}-\d{2}$/);
  return m ? d : d;
};

/**
 * News / press items on a page: dated headlines ("17.01.2023: Groundbreaking ceremony", also when the items
 * are accordions on one page) and teaser links to separate articles. Each item: { url, title, date, body }.
 */
export function newsItems(html, pageUrl) {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|head|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const base = new URL(pageUrl);
  const items = [];
  const marks = [];
  for (const m of body.matchAll(new RegExp(`<(a|h[2-6]|button|summary|dt|strong)\\b([^>]*)>\\s*(?:<[^>]+>\\s*)*(${DATE_RE})\\s*(?:[:–—|-]\\s*)?(?:<[^>]+>\\s*)*([^<]{8,220})`, 'gi'))) {
    const attr = (n) => m[2].match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    const href = attr('href') || (attr('aria-controls') ? `#${attr('aria-controls')}` : attr('id') ? `#${attr('id')}` : '');
    let url;
    try { url = new URL(decode(href || `#item-${marks.length + 1}`), base).href; } catch { continue; }
    marks.push({ start: m.index, end: m.index + m[0].length, url, date: isoDate(m[3].trim()), title: decode(m[4]).replace(/\s+/g, ' ').trim() });
  }
  marks.forEach((k, i) => items.push({ url: k.url, title: k.title, date: k.date, body: body.slice(k.end, Math.min(marks[i + 1]?.start ?? body.length, k.end + 20000)) }));
  if (!items.length) {
    // teaser lists: links with a headline-length text that lead deeper into the site
    const seen = new Set();
    for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
      let u;
      try { u = new URL(decode(m[1]), base); } catch { continue; }
      const title = textOf(m[2]).replace(/^(?:read more(?: about)?|weiterlesen|mehr(?: lesen| erfahren)?)\s*:?\s*/i, '');
      if (u.hostname !== base.hostname || title.length < 28 || title.length > 200 || u.pathname.split('/').filter(Boolean).length < 2 || seen.has(u.href)) continue;
      const near = body.slice(Math.max(0, m.index - 300), m.index + m[0].length + 300);
      const d = near.match(/datetime\s*=\s*["'](\d{4}-\d{2}-\d{2})/i)?.[1] || near.match(new RegExp(DATE_RE))?.[0];
      // a headline-length link is only a news item if it leads into a news section or carries a date
      if (!d && !NEWS_PAGE.test(u.pathname)) continue;
      seen.add(u.href);
      items.push({ url: u.href, title, date: d ? isoDate(d.trim()) : undefined, body: '' });
    }
  }
  return items.slice(0, 30);
}

/** Company facts usually printed in an imprint / legal notice. */
export function companyFacts(text) {
  const pick = (re) => text.match(re)?.[1]?.replace(/\s+/g, ' ').trim();
  const facts = {
    vat_id: pick(/(?:UID(?:-?\s?Nr\.?|-?Nummer)?|USt\.?-?\s?Id(?:ent)?(?:-?\s?Nr)?\.?|Umsatzsteuer-?Id[^:\n]{0,25}|VAT(?:\s(?:ID|No\.?|number|Reg(?:istration)?(?:\sNo\.?)?))?)\s*[:.]?\s*((?:ATU|DE|CHE|GB|FR|IT|NL|ES|BE|PL|CZ|HU|SK|SI)[ -]?[0-9][0-9A-Z. -]{6,13}[0-9A-Z])(?![0-9A-Za-z])/i),
    company_register: pick(/(?:Firmenbuch(?:nummer|-?\s?Nr\.?)?|\bFN)\s*[:.]?\s*(?:FN\s*)?(\d{3,6}\s?[a-z])\b/i) || pick(/\b(HR[AB]\s?\d{3,7}(?:\s?[A-Z])?)\b/) || pick(/(?:Company (?:No\.?|number)|Registered (?:No\.?|number))\s*[:.]?\s*([A-Z]{0,2}\d{6,8})/i),
    register_court: pick(/(?:Firmenbuchgericht|Registergericht|Handelsgericht|Amtsgericht|Landesgericht)\s*[:.]?\s*([^\n,;]{3,50})/i),
    legal_form: pick(/\b(GmbH\s?&\s?Co\.?\s?KG|GesmbH|GmbH|AG|KG|OG|e\.U\.|SE|Ltd\.?|LLC|Inc\.?|S\.A\.|B\.V\.)(?=[\s,.\n]|$)/),
  };
  const n = text.match(/(?:^|\n|[:•|])\s*([\p{Lu}][\p{L}\d&.\-]*(?: [\p{L}\d&.\-]+){0,5} (?:GmbH ?& ?Co\.? ?KG|GesmbH|GmbH|AG|KG|OG|SE|Ltd\.?|LLC|Inc\.?|B\.V\.))(?=[\s,.\n]|$)/u);
  if (n && n[1].length <= 60) facts.name = n[1].trim();
  facts.names = [...text.matchAll(/(?:^|\n|[:•|])\s*([\p{Lu}][\p{L}\d&.\-]*(?: [\p{L}\d&.\-]+){0,5} (?:GmbH ?& ?Co\.? ?KG|GesmbH|GmbH|AG|KG|OG|SE|Ltd\.?|LLC|Inc\.?|B\.V\.))(?=[\s,.\n]|$)/gu)].map((m) => m[1].trim()).filter((x) => x.length <= 60);
  if (!facts.names.length) delete facts.names;
  const a = text.match(/([\p{Lu}][\p{L}.\- ]{2,40}?(?:straße|strasse|str\.|gasse|weg|platz|allee|ring|zeile|kai|street|road|avenue|lane)\s*\d+[a-z]?(?:[-\/]\d+)?)\s*[,\n]\s*(?:[AD]-\s?)?(\d{4,5})\s+([\p{Lu}][\p{L} .\/-]{2,30})/u);
  if (a) facts.address = `${a[1].trim()}, ${a[2]} ${a[3].trim().split('\n')[0]}`;
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v));
}

function contactsIn(html, base) {
  const out = { emails: [], phones: [], profiles: [] };
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decode(m[1]).trim();
    if (/^mailto:/i.test(href)) { try { out.emails.push(decodeURIComponent(href.replace(/^(?:mailto:)+/i, '').split('?')[0]).trim().toLowerCase()); } catch { /* bad escape */ } }
    else if (/^tel:/i.test(href)) out.phones.push(decodeURIComponent(href.slice(4)).trim());
    else { let u; try { u = new URL(href, base).href; } catch { continue; } const sp = socialProfile(u); if (sp) out.profiles.push(sp); }
  }
  out.emails.push(...findEmails(textOf(html)).filter((e) => !/^mailto/.test(e)));
  out.emails = [...new Set(out.emails.map((e) => e.replace(/^mailto:?(?=[a-z0-9._%+-]+@)/, '')))].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e));
  out.phones = [...new Set(out.phones)];
  out.profiles = [...new Map(out.profiles.map((p) => [p.url.toLowerCase(), p])).values()];
  return out;
}

const imageIn = (html, base) => {
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const at = (n) => m[0].match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    // lazy-loading sites keep a placeholder in src and the real picture in data-src / data-srcset
    const srcset = at('data-srcset') || at('srcset');
    const src = at('data-src') || at('data-lazy-src') || (srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '') || at('src');
    if (!src || /^data:/i.test(src) || /logo|icon|sprite|placeholder|spacer|\.svg/i.test(src)) continue;
    try { return new URL(decode(src), base).href; } catch { /* bad URL */ }
  }
  return null;
};

/** People described on one page: [{ name, role, emails, phones, profiles, image, sure }]. */
export function extractPeople(html, pageUrl, own = []) {
  const people = new Map();
  const put = (name, data) => {
    const k = fold(name);
    const p = people.get(k) || { name, title: '', role: '', emails: [], phones: [], profiles: [], image: null, sure: false };
    const r = splitRole(data.role);
    p.role ||= r.role;
    p.title ||= data.title || '';
    if (r.degree && !p.title.includes(r.degree)) p.title = [p.title, r.degree].filter(Boolean).join(' ');
    p.staff ||= !!data.staff;
    p.context ||= data.context || '';
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
          staff: true, emails: typeof n.email === 'string' ? [n.email.replace(/^mailto:/, '').toLowerCase()] : [],
          phones: typeof n.telephone === 'string' ? [n.telephone] : [],
          profiles: [].concat(n.sameAs || [], n.url || []).map((u) => typeof u === 'string' && socialProfile(u)).filter(Boolean),
          image: typeof img === 'string' ? img : null });
      }
      Object.values(n).forEach((v) => typeof v === 'object' && walk(v));
    };
    try { walk(JSON.parse(m[1])); } catch { /* malformed JSON-LD */ }
  }

  // 2. visible "cards": a name in a heading (or an element whose class says it is a name) followed by details
  // inline placeholder images (lazy loading) can be kilobytes long and would push a portrait out of reach of its name
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/\s(?:src|srcset)\s*=\s*("data:[^"]*"|'data:[^']*')/gi, '');
  const cands = [];
  // two passes, so that a small container never swallows the heading inside it
  const scan = (re, heading) => {
    for (const m of body.matchAll(re)) {
      const klass = m[2].match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      const hinted = NAME_CLASS.test(klass) && !NOT_NAME_CLASS.test(klass);
      const cls = m[2].match(/class\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      const styled = /(^|\s)(h[1-6]|headline|heading|lead)(\s|$)/i.test(cls); // a div dressed up as a heading
      if (!heading && ((!hinted && !styled) || /<(div|p|li|h[1-6]|ul|table)\b/i.test(m[3]))) continue;
      const raw = textOf(m[3]);
      const { name, title } = parseName(raw);
      const inline = raw.split(/\s*[,|–—(]\s*/).slice(1).map((x) => x.replace(/\)$/, '').trim()).find((x) => x.length <= 60 && ROLE.test(x) && ownRole(x));
      if (name) cands.push({ name, title, inline, start: m.index, end: m.index + m[0].length, hinted, heading: /^h[1-6]$/i.test(m[1]), bold: heading && !/^h[1-6]$/i.test(m[1]) });
    }
  };
  scan(/<(h[1-6]|strong|b|dt|figcaption)\b([^>]*)>([\s\S]{2,240}?)<\/\1>/gi, true);
  scan(/<(span|div|p|a|li|td)\b([^>]*)>([\s\S]{2,160}?)<\/\1>/gi, false);
  // links to a person's own page: /about/staff/jane-doe with "Jane Doe" as the link text
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#?]+)[^"']*["'][^>]*>([\s\S]{2,160}?)<\/a>/gi)) {
    if (/<(img|div|p|li)\b/i.test(m[2])) continue;
    const raw = textOf(m[2]);
    const { name, title } = parseName(raw);
    const slug = decode(m[1]).match(PEOPLE_PATH)?.[1];
    if (!name || !slug) continue;
    const parts = fold(name).split(/\s+/);
    if (!fold(decodeURIComponent(slug)).includes(parts[parts.length - 1].replace(/[^a-z]/g, '').slice(0, 5))) continue;
    cands.push({ name, title, start: m.index, end: m.index + m[0].length, hinted: true, linked: true, heading: false });
  }
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
    const before = body.slice(Math.max(prev ? prev.end : 0, c.start - 1400), c.start);
    const contacts = contactsIn(seg, pageUrl);
    const pieces = seg.slice(0, 600).replace(/<[^>]+>/g, '\n').split('\n').map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const hasContactNear = /href\s*=\s*["'](?:mailto:|tel:)/i.test(seg.slice(0, 1500));
    // many sites print the job title in a small line directly above the name
    const kicker = before.slice(-320).replace(/<[^>]+>/g, '\n').split('\n').map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter(Boolean).pop() || '';
    const kickerOk = kicker.length >= 3 && kicker.length <= 60 && !parseName(kicker).name && !/[.!?:]$|@|\d{3}/.test(kicker) && !/^(foto|photo|bild|image|©|copyright)/i.test(kicker) && (ROLE.test(kicker) || (hasContactNear && c.heading));
    // an element whose class says "job title" wins; otherwise a short title-like line right after (or above) the name
    const classed = [...seg.slice(0, 900).matchAll(/<(div|span|p|small|em|dd|h[3-6])\b[^>]*class\s*=\s*["']([^"']*)["'][^>]*>([\s\S]{2,160}?)<\/\1>/gi)].find((x) => ROLE_CLASS.test(x[2]) && !/<(div|p)\b/i.test(x[3]));
    const roleLike = (t) => t.length >= 3 && t.length <= 60 && ROLE.test(t) && !parseName(t).name && /^[\p{Lu}\d]/u.test(t) && !/[.!?]$/.test(t);
    let role = c.inline || (classed && textOf(classed[3]).length <= 80 ? textOf(classed[3]) : '') || pieces.slice(0, 3).find(roleLike) || (kickerOk ? kicker : '');
    const beforeImgs = [...before.matchAll(/<img\b[^>]*>/gi)];
    const imgBefore = beforeImgs.length ? imageIn(beforeImgs[beforeImgs.length - 1][0], pageUrl) : null;
    // cards put the portrait either above or below the name; the first card tells which
    if (i === 0) portraitFirst = !!imgBefore;
    const image = portraitFirst ? imgBefore : imageIn(seg.slice(0, 500), pageUrl);
    // Evidence that this heading is a person and not a section title: a recognisable given name or a "name"
    // class, a job title right below it, or an address that spells the name.
    const nameish = c.hinted || c.linked || !!c.title || knownFirstName(c.name);
    const ownEmail = contacts.emails.some((e) => emailNameMatch(e, c.name));
    const hasContact = contacts.emails.length || contacts.phones.length || contacts.profiles.length;
    const corroborated = ownEmail || (nameish && (!!role || hasContact || onPeoplePage));
    if (!corroborated && !(role && (hasContact || onPeoplePage)) && !(nameish && c.heading)) return;
    // a bold name in a paragraph with nothing attached is prose, which the mention reader below handles better
    if (c.bold && !role && !hasContact) return;
    // a lone e-mail far from the name is more likely the site's general address than this person's
    if (!role && !c.hinted && contacts.emails.length > 2) contacts.emails = [];
    put(c.name, { ...contacts, title: c.title, role, image: role || c.hinted || onPeoplePage ? image : null, sure: corroborated, staff: corroborated && (!!role || !!hasContact || onPeoplePage) });
  });

  // 3. names in running text: imprint lines, academic titles, "Name, Role"
  const text = blockText(html);
  const staffPage = STAFF_PAGE.test(new URL(pageUrl).pathname);
  for (const t of peopleInText(text, own, staffPage)) put(t.name, { title: t.title, role: t.role, sure: t.sure, staff: t.staff });
  // 4. people talked about in prose; only those introduced with the site's own name belong to it
  for (const t of mentionsInText(text, own)) put(t.name, { title: t.title, role: t.role, sure: true, staff: t.own || staffPage, context: t.context });

  for (const [k, p] of [...people]) {
    const shorter = [...people.keys()].find((o) => o !== k && k.startsWith(`${o} `));
    if (!shorter) continue;
    const q = people.get(shorter);
    q.role ||= p.role; q.title ||= p.title; q.staff ||= p.staff; q.emails.push(...p.emails); q.phones.push(...p.phones); q.profiles.push(...p.profiles);
    people.delete(k);
  }
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
