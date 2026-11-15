import { TYPES, GROUPS, normalize, keyOf, detectType } from '/shared/entities.js';
import { iconSvg, iconDataUri } from '/icons.js';
import { TEMPLATES } from '/templates.js';

const BG = '#0d1117';
const $ = (s) => document.querySelector(s);

/** DOM builder. Everything scraped from the internet goes through textContent, never innerHTML. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'icon') el.innerHTML = iconSvg(v); // trusted, static markup
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const chip = (type) => h('span', { class: 'chip', style: `background:${TYPES[type].color}`, icon: type });
const extLink = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
const imgUrl = (value) => `/api/img?u=${encodeURIComponent(value)}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

// ---- state ------------------------------------------------------------------------------------
let modules = [];
let ws = null;
const hiddenTypes = new Set();
const runState = new Map(); // node key → Map(module id → { state, msg })
let pathActive = false;

// ---- graph ------------------------------------------------------------------------------------
const cy = cytoscape({
  container: $('#cy'),
  wheelSensitivity: 0.3,
  minZoom: 0.08,
  maxZoom: 3.5,
  style: [
    { selector: 'node', style: {
      'background-color': (n) => TYPES[n.data('type')].color,
      'background-image': (n) => (n.data('type') === 'photo' ? imgUrl(n.data('value')) : iconDataUri(n.data('type'), BG)),
      'background-fit': (n) => (n.data('type') === 'photo' ? 'cover' : 'none'),
      'background-width': '54%', 'background-height': '54%',
      shape: (n) => (n.data('type') === 'photo' ? 'round-rectangle' : 'ellipse'),
      width: 'data(size)', height: 'data(size)',
      label: 'data(display)', color: '#c9d3df', 'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': 5,
      'text-wrap': 'ellipsis', 'text-max-width': 150, 'text-outline-color': BG, 'text-outline-width': 2, 'min-zoomed-font-size': 6,
      'border-width': 0, 'overlay-opacity': 0,
    } },
    { selector: 'node.guess', style: { opacity: 0.6, 'border-width': 2, 'border-style': 'dashed', 'border-color': '#ffffff' } },
    { selector: 'node.running', style: { 'underlay-color': '#4aa8ff', 'underlay-opacity': 0.35, 'underlay-padding': 9, 'underlay-shape': 'ellipse' } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-style': 'solid', 'border-color': '#ffffff', opacity: 1, color: '#ffffff' } },
    { selector: 'edge', style: {
      width: 1.2, 'line-color': '#364354', 'target-arrow-color': '#364354', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'bezier',
      'font-size': 9.5, color: '#aab6c5', 'text-rotation': 'autorotate', 'text-background-color': BG, 'text-background-opacity': 0.9, 'text-background-padding': 2,
      'overlay-opacity': 0,
    } },
    { selector: 'edge.show-label, edge:selected', style: { label: 'data(label)', 'line-color': '#8494a8', 'target-arrow-color': '#8494a8', width: 1.8 } },
    { selector: 'edge[module = "match"]', style: { 'line-style': 'dashed', 'line-color': '#c58af9', 'target-arrow-shape': 'none', label: 'data(label)', color: '#c58af9' } },
    { selector: '.faded', style: { opacity: 0.1 } },
    { selector: 'node.path', style: { 'border-width': 3, 'border-color': '#ffd166' } },
    { selector: 'edge.path', style: { 'line-color': '#ffd166', 'target-arrow-color': '#ffd166', width: 3, label: 'data(label)' } },
    { selector: '.hidden', style: { display: 'none' } },
  ],
});
window.cy = cy; // handy for debugging from the console

const node = (key) => cy.getElementById(key);

function displayOf(type, value, label) {
  let t = label || value;
  if (!label && (type === 'url' || type === 'profile')) t = value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  if (!label && type === 'photo') t = value.startsWith('upload://') ? 'uploaded photo' : new URL(value).hostname;
  if (!label && type === 'certificate') t = `${value.slice(0, 12)}…`;
  return t.length > 44 ? `${t.slice(0, 43)}…` : t;
}

/** Adds an entity, or merges it into the node that already represents it. */
function upsert(ent, near, source) {
  const value = normalize(ent.type, ent.value);
  const key = keyOf(ent.type, ent.value);
  if (!key) return null;
  const existing = node(key);
  if (existing.length) {
    const d = existing.data();
    existing.data('props', { ...d.props, ...ent.props });
    if (ent.label && !d.label) existing.data({ label: ent.label, display: displayOf(d.type, d.value, ent.label) });
    if (source && !d.sources.includes(source)) existing.data('sources', [...d.sources, source]);
    // a confirmed sighting upgrades a guessed node
    if (d.props?.confidence && !ent.props?.confidence && source !== 'manual') { const { confidence, ...rest } = existing.data('props'); existing.data('props', rest); }
    existing.toggleClass('guess', !!existing.data('props').confidence);
    return { key, isNew: false };
  }
  // unconnected newcomers are parked beside the existing graph instead of on top of it
  const bb = cy.nodes().length ? cy.nodes().boundingBox() : null;
  const p = near || (bb ? { x: bb.x2 + 140, y: bb.y1 + bb.h / 2 + (Math.random() - 0.5) * Math.max(bb.h, 200) } : { x: 0, y: 0 });
  const n = cy.add({
    group: 'nodes',
    data: { id: key, type: ent.type, value, label: ent.label || '', display: displayOf(ent.type, value, ent.label), props: { ...ent.props }, sources: source ? [source] : [], notes: ent.notes || '', size: 32 },
    position: ent.x != null ? { x: ent.x, y: ent.y } : { x: p.x + (Math.random() - 0.5) * 120, y: p.y + (Math.random() - 0.5) * 120 },
  });
  if (ent.props?.confidence) n.addClass('guess');
  if (hiddenTypes.has(ent.type)) n.addClass('hidden');
  return { key, isNew: true };
}

function addEdge(a, b, label, module) {
  if (a === b || !node(a).length || !node(b).length) return false;
  const id = `${a}→${b}→${label}`;
  if (cy.getElementById(id).length || cy.getElementById(`${b}→${a}→${label}`).length) return false;
  cy.add({ group: 'edges', data: { id, source: a, target: b, label, module } });
  return true;
}

function refreshSizes() {
  cy.batch(() => cy.nodes().forEach((n) => n.data('size', Math.round(34 + Math.min(30, Math.sqrt(n.degree(false)) * 6)))));
}

const hamming = (a, b) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };

/** Pictures with the same content (re-encoded avatars, re-posted photos) get linked to each other. */
function linkMatchingPhotos() {
  const photos = cy.nodes('[type = "photo"]').filter((n) => n.data('props').phash || n.data('props').sha256);
  let linked = 0;
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const a = photos[i].data('props'), b = photos[j].data('props');
      const same = (a.sha256 && a.sha256 === b.sha256) || (a.phash && b.phash && hamming(a.phash, b.phash) <= 5);
      if (same && addEdge(photos[i].id(), photos[j].id(), 'same picture', 'match')) linked++;
    }
  }
  if (linked) log(`Linked ${linked} pair${linked > 1 ? 's' : ''} of matching pictures.`);
}

/** Merge a module result into the graph. Returns the keys of nodes that did not exist before. */
function merge(inputKey, moduleId, result) {
  const src = node(inputKey);
  if (!src.length) return [];
  const added = [];
  cy.batch(() => {
    if (Object.keys(result.props || {}).length) src.data('props', { ...src.data('props'), ...result.props });
    for (const e of result.entities) {
      const r = upsert(e, src.position(), moduleId);
      if (r?.isNew) added.push(r.key);
    }
    for (const e of result.entities) {
      for (const edge of e.edges || []) {
        let a = node(edge.from).length ? edge.from : inputKey;
        let b = e.key;
        if (edge.reverse) [a, b] = [b, a];
        addEdge(a, b, edge.rel, moduleId);
      }
    }
  });
  afterChange(added);
  return added;
}

function afterChange(added = []) {
  linkMatchingPhotos();
  refreshSizes();
  renderLegend();
  if (added.length) scheduleLayout(added);
  scheduleSave();
  $('#empty').hidden = cy.nodes().length > 0;
}

// ---- layout -----------------------------------------------------------------------------------
let pendingNew = new Set();
let layoutTimer = null;
function scheduleLayout(keys) {
  keys.forEach((k) => pendingNew.add(k));
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { const fresh = pendingNew; pendingNew = new Set(); runLayout(fresh); }, 200);
}

/** Without arguments re-arranges everything; with a set of new keys keeps existing nodes where they are. */
function runLayout(fresh) {
  const visible = cy.elements().not('.hidden');
  if (visible.nodes().length < 2) { if (visible.nodes().length) cy.animate({ center: { eles: visible }, zoom: 1 }, { duration: 200 }); return; }
  const name = $('#layout-select').value;
  const anim = { animate: true, animationDuration: 450 };
  if (name !== 'fcose') {
    const extra = { concentric: { concentric: (n) => n.degree(false), levelWidth: () => 2, minNodeSpacing: 40 }, breadthfirst: { spacingFactor: 1.1, directed: false }, circle: {}, grid: { avoidOverlapPadding: 30 } }[name];
    visible.layout({ name, fit: true, padding: 50, ...anim, ...extra }).run();
    return;
  }
  const fixed = fresh ? cy.nodes().filter((n) => !fresh.has(n.id()) && !n.hasClass('hidden')) : cy.collection();
  const incremental = fixed.length > 0;
  visible.layout({
    name: 'fcose', quality: 'default', ...anim, randomize: !incremental, fit: !incremental, padding: 50,
    nodeRepulsion: 12000, idealEdgeLength: 110, edgeElasticity: 0.4, nodeSeparation: 90, gravity: 0.2, packComponents: true, nodeDimensionsIncludeLabels: true,
    fixedNodeConstraint: incremental ? fixed.map((n) => ({ nodeId: n.id(), position: { ...n.position() } })) : undefined,
  }).run();
}

// ---- running modules ----------------------------------------------------------------------------
const MAX_PARALLEL = 4;
let running = 0;
const waiting = [];
function enqueue(job) {
  return new Promise((resolve) => { waiting.push({ job, resolve }); pump(); });
}
function pump() {
  while (running < MAX_PARALLEL && waiting.length) {
    const { job, resolve } = waiting.shift();
    running++;
    job().then(resolve, () => resolve(null)).finally(() => { running--; pump(); showJobs(); });
  }
  showJobs();
}
function showJobs() {
  const n = running + waiting.length;
  $('#jobs').hidden = n === 0;
  $('#jobs-text').textContent = `${n} search${n === 1 ? '' : 'es'} running`;
}

const modulesFor = (type) => modules.filter((m) => m.inputs.includes(type));
const modById = (id) => modules.find((m) => m.id === id);

function setRunState(key, modId, st) {
  if (!runState.has(key)) runState.set(key, new Map());
  runState.get(key).set(modId, st);
  const n = node(key);
  if (n.length) n.toggleClass('running', [...runState.get(key).values()].some((s) => s.state === 'run'));
  if (isSelected(key)) renderDetails();
}

async function runModule(key, modId) {
  const n = node(key);
  const mod = modById(modId);
  if (!n.length || !mod || runState.get(key)?.get(modId)?.state === 'run') return [];
  setRunState(key, modId, { state: 'run', msg: 'Searching…' });
  const d = n.data();
  return enqueue(async () => {
    let res;
    const near = (type) => node(key).neighborhood(`node[type = "${type}"]`).filter((x) => !x.data('props').confidence).map((x) => x.data('value')).slice(0, 5);
    const context = d.type === 'person' ? { orgs: near('organization'), domains: near('domain') } : undefined;
    try { res = await api('/api/run', { method: 'POST', body: { module: modId, entity: { type: d.type, value: d.value, props: d.props, context } } }); }
    catch (e) { res = { ok: false, error: e.message }; }
    if (!node(key).length) return [];
    if (!res.ok) {
      setRunState(key, modId, { state: 'err', msg: res.error });
      log(`${mod.name} on ${d.display}: ${res.error}`, 'err');
      return [];
    }
    const added = merge(key, modId, res);
    const found = res.entities.length;
    const msg = found ? `${found} result${found > 1 ? 's' : ''}, ${added.length} new` : Object.keys(res.props).length ? 'Facts added to this entity' : 'Nothing found';
    setRunState(key, modId, { state: 'ok', msg });
    log(`${mod.name} on ${d.display}: ${msg.toLowerCase()}.`);
    res.notes.forEach((t) => log(t, 'note'));
    return added;
  });
}

async function runAll(key) {
  const n = node(key);
  if (!n.length) return [];
  const mods = modulesFor(n.data('type')).filter((m) => m.auto !== false);
  return (await Promise.all(mods.map((m) => runModule(key, m.id)))).flat();
}

/** Run every automatic search on a node, then on what that finds, up to `depth` levels. */
async function discover(rootKey, depth = 2) {
  const BUDGET = 40;
  let frontier = [rootKey];
  const done = new Set();
  let used = 0;
  log(`Discovering from ${node(rootKey).data('display')} (${depth} levels)…`);
  for (let level = 0; level < depth && frontier.length; level++) {
    const batch = frontier.filter((k) => !done.has(k)).slice(0, BUDGET - used);
    used += batch.length;
    batch.forEach((k) => done.add(k));
    const found = (await Promise.all(batch.map(runAll))).flat();
    // guesses and shared infrastructure are dead ends that would only flood the graph
    frontier = found.filter((k) => { const n = node(k); return n.length && !n.data('props').confidence && !['technology', 'vulnerability', 'location', 'organization', 'netblock', 'service'].includes(n.data('type')); });
    if (used >= BUDGET) { log(`Stopped after ${BUDGET} entities to keep the graph readable. Continue from any node.`, 'note'); break; }
  }
  log('Discovery finished.');
}

// ---- templates ----------------------------------------------------------------------------------
const templatesFor = (type) => TEMPLATES.filter((t) => t.inputs.includes(type));

/** Runs a template's steps in order; each step works on what the earlier steps found. */
async function runTemplate(tpl, rootKey) {
  const root = node(rootKey);
  if (!root.length) return;
  const scope = new Set([rootKey]);
  const done = new Set();
  log(`Template “${tpl.name}” started on ${root.data('display')}.`, 'step');
  for (const [i, step] of tpl.steps.entries()) {
    let pool = [...scope];
    // entities that were already attached to the starting point before the template ran count as well
    if (step.neighbours && node(rootKey).length) pool = [...new Set([...pool, ...node(rootKey).neighborhood('node').map((n) => n.id())])];
    const targets = (step.on === 'start' ? [rootKey] : pool.filter((k) => {
      const n = node(k);
      return n.length && k !== rootKey && step.on.includes(n.data('type')) && (step.guesses || !n.data('props').confidence);
    })).slice(0, step.limit || 20);
    const jobs = [];
    for (const k of targets) {
      for (const m of step.modules) {
        if (!modById(m)?.inputs.includes(node(k).data('type')) || done.has(`${k}|${m}`)) continue;
        done.add(`${k}|${m}`);
        jobs.push(runModule(k, m));
      }
    }
    if (!jobs.length) continue;
    log(`Step ${i + 1} of ${tpl.steps.length}: ${step.label} (${targets.length} ${targets.length === 1 ? 'entity' : 'entities'})…`, 'step');
    (await Promise.all(jobs)).flat().forEach((k) => scope.add(k));
  }
  const people = [...scope].filter((k) => node(k).length && node(k).data('type') === 'person' && k !== rootKey).length;
  log(`Template “${tpl.name}” finished: ${scope.size - 1} new entities${people ? `, ${people} of them people. Select a person and run “Investigate a person” to go deeper` : ''}.`, 'step');
  // let the last layout pass settle before framing the result
  setTimeout(() => cy.animate({ fit: { eles: cy.elements().not('.hidden'), padding: 60 } }, { duration: 300 }), 900);
}

function openTemplates() {
  const sel = selected();
  const cur = sel.length === 1 ? sel[0].data() : null;
  $('#tpl-list').replaceChildren(...TEMPLATES.map((t) => {
    const input = h('input', { type: 'text', placeholder: t.placeholder, 'aria-label': `Starting point for ${t.name}`, spellcheck: 'false', value: cur && t.inputs.includes(cur.type) ? cur.value : null });
    const start = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      const guess = detectType(v);
      const key = addManual(t.inputs.includes(guess) ? guess : t.inputs[0], v);
      if (!key) return;
      $('#dlg-templates').close();
      runTemplate(t, key);
    };
    return h('div', { class: 'tpl' },
      h('h3', {}, chip(t.inputs[0]), t.name),
      h('p', {}, t.description),
      h('ol', {}, t.steps.map((st) => h('li', {}, st.label))),
      h('form', { onsubmit: start }, input, h('button', { class: 'primary', type: 'submit' }, 'Run')));
  }));
  $('#dlg-templates').showModal();
}

// ---- details panel ------------------------------------------------------------------------------
const selected = () => cy.nodes(':selected');
const isSelected = (key) => { const s = selected(); return s.length === 1 && s[0].id() === key; };

function pivots(type, value, props) {
  const q = encodeURIComponent(value);
  const g = (s) => `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  switch (type) {
    case 'person': return [['Google', g(`"${value}"`)], ['Bing', `https://www.bing.com/search?q=%22${q}%22`], ['LinkedIn', g(`site:linkedin.com/in "${value}"`)], ['Facebook', `https://www.facebook.com/search/people/?q=${q}`], ['X', `https://x.com/search?q=%22${q}%22&f=user`], ['Instagram', g(`site:instagram.com "${value}"`)], ['News', `https://news.google.com/search?q=%22${q}%22`]];
    case 'username': return [['X', `https://x.com/${q}`], ['Instagram', `https://www.instagram.com/${q}`], ['Facebook', `https://www.facebook.com/${q}`], ['TikTok', `https://www.tiktok.com/@${q}`], ['YouTube', `https://www.youtube.com/@${q}`], ['Twitch', `https://www.twitch.tv/${q}`], ['Google', g(`"${value}"`)]];
    case 'email': return [['Google', g(`"${value}"`)], ['Have I Been Pwned', 'https://haveibeenpwned.com/'], ['Epieos', `https://epieos.com/?q=${q}`]];
    case 'phone': return [['Google', g(`"${value}"`)], ['WhatsApp', `https://wa.me/${value.replace(/\D/g, '')}`]];
    case 'organization': return [['Google', g(`"${value}"`)], ['OpenCorporates', `https://opencorporates.com/companies?q=${q}`], ['LinkedIn', `https://www.linkedin.com/search/results/companies/?keywords=${q}`]];
    case 'location': {
      const m = props.lat != null ? `${props.lat},${props.lon}` : value;
      return [['OpenStreetMap', props.lat != null ? `https://www.openstreetmap.org/?mlat=${props.lat}&mlon=${props.lon}#map=14/${props.lat}/${props.lon}` : `https://www.openstreetmap.org/search?query=${q}`], ['Google Maps', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m)}`]];
    }
    case 'photo': {
      if (value.startsWith('upload://')) return [];
      return [['Google Lens', `https://lens.google.com/uploadbyurl?url=${q}`], ['Yandex', `https://yandex.com/images/search?rpt=imageview&url=${q}`], ['TinEye', `https://tineye.com/search?url=${q}`], ['Bing', `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${q}`], ['Open original', value]];
    }
    case 'domain': return [['Open site', `https://${value}`], ['crt.sh', `https://crt.sh/?q=${q}`], ['urlscan', `https://urlscan.io/search/#domain%3A${q}`], ['VirusTotal', `https://www.virustotal.com/gui/domain/${q}`], ['Shodan', `https://www.shodan.io/search?query=hostname%3A${q}`], ['Wayback', `https://web.archive.org/web/*/${q}`]];
    case 'ip': return [['Shodan', `https://www.shodan.io/host/${q}`], ['Censys', `https://search.censys.io/hosts/${q}`], ['VirusTotal', `https://www.virustotal.com/gui/ip-address/${q}`], ['AbuseIPDB', `https://www.abuseipdb.com/check/${q}`], ['GreyNoise', `https://viz.greynoise.io/ip/${q}`]];
    case 'asn': return [['bgp.he.net', `https://bgp.he.net/${q}`], ['PeeringDB', `https://www.peeringdb.com/search?q=${q}`]];
    case 'netblock': return [['bgp.he.net', `https://bgp.he.net/net/${value}`]];
    case 'url': case 'profile': return [['Open', value], ['Wayback', `https://web.archive.org/web/*/${value}`], ['urlscan', `https://urlscan.io/search/#${encodeURIComponent(`page.url:"${value}"`)}`]];
    case 'certificate': return [['crt.sh', `https://crt.sh/?q=${q}`], ['Censys', `https://search.censys.io/certificates/${q}`]];
    case 'vulnerability': return [['NVD', `https://nvd.nist.gov/vuln/detail/${q}`], ['CVE.org', `https://www.cve.org/CVERecord?id=${q}`]];
    case 'technology': return [['Google', g(value)], ['CVE search', `https://www.cve.org/CVERecord/SearchResults?query=${q}`]];
    default: return [['Google', g(`"${value}"`)]];
  }
}

function renderDetails() {
  const box = $('#details');
  const sel = selected();
  const focusedNotes = document.activeElement?.id === 'notes';
  const caret = focusedNotes ? document.activeElement.selectionStart : 0;
  const scroll = box.scrollTop;
  box.replaceChildren();

  if (sel.length === 0) {
    box.append(h('div', { class: 'd-empty' },
      h('h3', {}, 'Nothing selected'),
      h('p', {}, 'Click a node to see what is known about it and which searches can be run on it.'),
      h('ul', {},
        h('li', {}, 'Right-click a node for a quick menu.'),
        h('li', {}, h('kbd', {}, 'Shift'), ' + click or drag selects several nodes; with two selected you can trace how they are connected.'),
        h('li', {}, h('kbd', {}, 'Delete'), ' removes the selection, ', h('kbd', {}, '/'), ' jumps to the add box.'),
        h('li', {}, 'Dashed, see-through nodes are guesses or unverified candidates.'))));
    return;
  }

  if (sel.length > 1) {
    box.append(h('div', { class: 'd-head' }, h('div', {}, h('div', { class: 'd-value' }, `${sel.length} entities selected`))));
    const actions = h('div', { class: 'd-actions' });
    if (sel.length === 2) actions.append(h('button', { class: 'primary', onclick: () => showPath(sel[0], sel[1]) }, 'Show how they connect'));
    actions.append(
      h('button', { onclick: () => sel.forEach((n) => runAll(n.id())) }, 'Run all searches'),
      h('button', { class: 'danger', onclick: () => removeNodes(sel) }, 'Delete'));
    box.append(actions, h('h2', {}, 'Selection'));
    sel.forEach((n) => box.append(connRow(n, TYPES[n.data('type')].label)));
    return;
  }

  const n = sel[0];
  const d = n.data();
  const key = n.id();
  const head = h('div', {},
    h('div', { class: 'd-type' }, TYPES[d.type].label, d.props.confidence ? h('span', { class: 'badge', title: 'Not verified: generated or matched by name only' }, d.props.confidence) : null),
    h('div', { class: 'd-value' }, d.value.startsWith('upload://') ? 'Uploaded photo' : d.value),
    d.label && d.label !== d.value ? h('div', { class: 'd-label' }, d.label) : null);
  box.append(h('div', { class: 'd-head' }, chip(d.type), head));
  if (d.type === 'photo') box.append(h('img', { class: 'd-photo', src: imgUrl(d.value), alt: 'Photo preview', loading: 'lazy' }));

  const mods = modulesFor(d.type);
  box.append(h('div', { class: 'd-actions' },
    h('button', { class: 'primary', disabled: !mods.length, onclick: () => runAll(key), title: 'Run every automatic search below' }, 'Run all searches'),
    h('button', { disabled: !mods.length, onclick: () => discover(key, 2), title: 'Run all searches here, then again on everything they find' }, 'Discover 2 levels'),
    h('button', { class: 'danger', onclick: () => removeNodes(n) }, 'Delete')));

  const tpls = templatesFor(d.type);
  if (tpls.length) {
    box.append(h('h2', {}, 'Templates'), h('div', { class: 'tpl-btns' },
      tpls.map((t) => h('button', { onclick: () => runTemplate(t, key) }, t.name, h('small', {}, `${t.description.split('. ')[0].replace(/\.$/, '')}.`)))));
  }

  const props = Object.entries(d.props).filter(([k, v]) => k !== 'confidence' && v != null && v !== '');
  if (props.length) {
    const dl = h('dl', { class: 'props' });
    for (const [k, v] of props) {
      const s = String(v);
      dl.append(h('dt', {}, k.replace(/_/g, ' ')), h('dd', {}, /^https?:\/\/\S+$/.test(s) ? extLink(s, s.replace(/^https?:\/\/(www\.)?/, '')) : s));
    }
    box.append(h('h2', {}, 'Known facts'), dl);
  }

  if (mods.length) {
    box.append(h('h2', {}, 'Searches'));
    const st = runState.get(key);
    for (const m of mods) {
      const s = st?.get(m.id);
      box.append(h('div', { class: 'mod' },
        h('div', { class: 'mod-name' }, m.name, h('span', { class: 'mod-src' }, m.source)),
        h('div', { class: 'mod-desc' }, m.description),
        h('button', { disabled: s?.state === 'run', onclick: () => runModule(key, m.id) }, s?.state === 'run' ? h('span', { class: 'spinner' }) : s ? 'Again' : 'Run'),
        s && s.state !== 'run' ? h('div', { class: `mod-state ${s.state}` }, s.msg) : null));
    }
  }

  const links = pivots(d.type, d.value, d.props);
  if (links.length) box.append(h('h2', {}, 'Look up elsewhere'), h('div', { class: 'pivots' }, links.map(([t, href]) => extLink(href, t))));

  box.append(h('h2', {}, 'Notes'), h('textarea', { id: 'notes', placeholder: 'Your notes on this entity…', oninput: (e) => { n.data('notes', e.target.value); scheduleSave(); } }, d.notes || ''));

  const edges = n.connectedEdges().filter((e) => !e.hasClass('hidden'));
  if (edges.length) {
    box.append(h('h2', {}, `Connections (${edges.length})`));
    edges.sort((a, b) => a.data('label').localeCompare(b.data('label'))).forEach((e) => {
      const out = e.source().id() === key;
      box.append(connRow(out ? e.target() : e.source(), `${out ? '→' : '←'} ${e.data('label')}`));
    });
  }
  if (d.sources.length) box.append(h('h2', {}, 'Found by'), h('div', { class: 'muted' }, d.sources.map((s) => modById(s)?.name || (s === 'manual' ? 'Added by hand' : s === 'text' ? 'Text extraction' : s)).join(', ')));

  box.scrollTop = scroll;
  if (focusedNotes) { const t = $('#notes'); t.focus(); t.setSelectionRange(caret, caret); }
}

function connRow(n, rel) {
  return h('button', { class: 'conn', title: n.data('value'), onclick: () => focusNode(n) }, chip(n.data('type')), h('span', { class: 'v' }, n.data('display')), h('span', { class: 'r' }, rel));
}

function focusNode(n) {
  clearPath();
  cy.elements().unselect();
  n.select();
  cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 300 });
}

function removeNodes(nodes) {
  nodes.forEach((n) => runState.delete(n.id()));
  cy.remove(nodes);
  afterChange();
  renderDetails();
}

// ---- highlighting: edge labels, search, path ----------------------------------------------------
function refreshEdgeLabels(hover) {
  cy.edges().removeClass('show-label');
  selected().connectedEdges().addClass('show-label');
  if (hover) hover.connectedEdges().addClass('show-label');
}

function clearPath() {
  if (!pathActive) return;
  pathActive = false;
  cy.elements().removeClass('path faded');
  applySearch();
}

function showPath(a, b) {
  const visible = cy.elements().not('.hidden');
  const r = visible.aStar({ root: a, goal: b, directed: false });
  if (!r.found) { log(`No connection between ${a.data('display')} and ${b.data('display')} yet.`, 'note'); return; }
  pathActive = true;
  cy.elements().removeClass('path').addClass('faded');
  r.path.removeClass('faded').addClass('path');
  cy.animate({ fit: { eles: r.path, padding: 140 } }, { duration: 300 });
  log(`${a.data('display')} and ${b.data('display')} are ${r.distance} step${r.distance > 1 ? 's' : ''} apart: ${r.path.nodes().map((n) => n.data('display')).join(' → ')}`);
}

function applySearch() {
  if (pathActive) return;
  const q = $('#search').value.trim().toLowerCase();
  cy.elements().removeClass('faded');
  if (!q) return cy.collection();
  const hits = cy.nodes().filter((n) => {
    const d = n.data();
    return d.value.toLowerCase().includes(q) || d.display.toLowerCase().includes(q) || (d.notes || '').toLowerCase().includes(q) || Object.values(d.props).some((v) => String(v).toLowerCase().includes(q));
  });
  cy.elements().not(hits).addClass('faded');
  return hits;
}

// ---- legend / filters ---------------------------------------------------------------------------
function renderLegend() {
  const counts = {};
  cy.nodes().forEach((n) => { counts[n.data('type')] = (counts[n.data('type')] || 0) + 1; });
  const box = $('#legend');
  box.replaceChildren();
  for (const g of GROUPS) {
    box.append(h('h3', {}, g));
    for (const [type, t] of Object.entries(TYPES).filter(([, v]) => v.group === g)) {
      const off = hiddenTypes.has(type);
      box.append(h('button', {
        class: `legend-row${counts[type] ? '' : ' zero'}${off ? ' off' : ''}`, 'aria-pressed': String(!off), title: off ? `Show ${t.label} nodes` : `Hide ${t.label} nodes`,
        onclick: () => { off ? hiddenTypes.delete(type) : hiddenTypes.add(type); cy.nodes(`[type = "${type}"]`).toggleClass('hidden', !off); renderLegend(); renderDetails(); },
      }, chip(type), h('span', { class: 'name' }, t.label), h('span', { class: 'n' }, counts[type] || '')));
    }
  }
  $('#stats').textContent = `${cy.nodes().length} entities · ${cy.edges().length} links`;
}

// ---- log ----------------------------------------------------------------------------------------
function log(text, kind = '') {
  const box = $('#log');
  box.prepend(h('div', { class: kind }, h('time', {}, new Date().toTimeString().slice(0, 8)), text));
  while (box.children.length > 300) box.lastChild.remove();
}

// ---- workspaces ---------------------------------------------------------------------------------
function serialize() {
  return {
    name: ws.name,
    nodes: cy.nodes().map((n) => { const { id, type, value, label, props, sources, notes } = n.data(); const p = n.position(); return { type, value, label, props, sources, notes, x: Math.round(p.x), y: Math.round(p.y) }; }),
    edges: cy.edges().map((e) => { const { source, target, label, module } = e.data(); return { source, target, label, module }; }),
  };
}

let saveTimer = null;
function scheduleSave() {
  if (!ws) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!ws) return;
  try { await api(`/api/workspaces/${ws.id}`, { method: 'PUT', body: serialize() }); }
  catch (e) { log(`Could not save: ${e.message}`, 'err'); }
}

function loadGraph(data) {
  clearPath();
  runState.clear();
  cy.elements().remove();
  const needsLayout = (data.nodes || []).some((n) => n.x == null);
  cy.batch(() => {
    for (const n of data.nodes || []) {
      const r = upsert(n, { x: 0, y: 0 });
      if (r) node(r.key).data('sources', n.sources || []);
    }
    for (const e of data.edges || []) addEdge(e.source, e.target, e.label, e.module);
  });
  refreshSizes();
  renderLegend();
  renderDetails();
  $('#empty').hidden = cy.nodes().length > 0;
  if (needsLayout) runLayout(); else cy.fit(undefined, 60);
  if (cy.nodes().length === 1) cy.zoom(1), cy.center();
}

async function refreshWorkspaceList() {
  const list = await api('/api/workspaces');
  const sel = $('#ws-select');
  sel.replaceChildren(...list.map((w) => h('option', { value: w.id }, w.name)));
  if (ws) sel.value = ws.id;
  return list;
}

async function openWorkspace(id) {
  if (ws) await saveNow();
  const w = await api(`/api/workspaces/${id}`);
  ws = { id: w.id, name: w.name };
  try { localStorage.setItem('communis.ws', w.id); } catch { /* storage unavailable */ }
  $('#ws-select').value = w.id;
  loadGraph(w);
}

async function createWorkspace(name, data = {}) {
  const w = await api('/api/workspaces', { method: 'POST', body: { name, nodes: data.nodes, edges: data.edges } });
  await refreshWorkspaceList();
  await openWorkspace(w.id);
}

function download(name, content, mime) {
  const url = typeof content === 'string' && content.startsWith('data:') ? content : URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  if (!url.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = () => (ws.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'investigation').toLowerCase();

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.nodes)) throw new Error('not a Communis export');
    await createWorkspace(data.name || file.name.replace(/\.json$/, ''), data);
    log(`Imported ${data.nodes.length} entities.`);
  } catch (e) { log(`Import failed: ${e.message}`, 'err'); }
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function exportCsv() {
  const rows = [['type', 'value', 'label', 'connections', 'notes', 'facts'].join(',')];
  cy.nodes().forEach((n) => { const d = n.data(); rows.push([d.type, d.value, d.label, n.degree(false), d.notes, Object.entries(d.props).map(([k, v]) => `${k}=${v}`).join('; ')].map(csvCell).join(',')); });
  download(`${slug()}-entities.csv`, rows.join('\n'), 'text/csv');
}

// ---- menus --------------------------------------------------------------------------------------
function openMenu(x, y, items) {
  const menu = $('#ctx');
  menu.replaceChildren(...items.map((it) => (it === '-' ? h('hr') : h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.run(); } }, it.label, it.hint ? h('small', {}, it.hint) : null))));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 8))}px`;
}
const closeMenu = () => { $('#ctx').hidden = true; };

function nodeMenu(n, x, y) {
  const key = n.id();
  const mods = modulesFor(n.data('type'));
  openMenu(x, y, [
    ...templatesFor(n.data('type')).map((t) => ({ label: t.name, hint: 'template', run: () => runTemplate(t, key) })),
    ...(templatesFor(n.data('type')).length ? ['-'] : []),
    ...(mods.length ? [{ label: 'Run all searches', run: () => runAll(key) }, { label: 'Discover 2 levels', run: () => discover(key, 2) }, '-',
      ...mods.map((m) => ({ label: m.name, hint: m.source, run: () => runModule(key, m.id) })), '-'] : []),
    { label: 'Select neighbours', run: () => n.neighborhood('node').select() },
    { label: 'Delete', danger: true, run: () => removeNodes(n) },
  ]);
}

function workspaceMenu(btn) {
  const r = btn.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: 'New investigation', run: async () => { const name = prompt('Name of the new investigation', 'New investigation'); if (name) await createWorkspace(name); } },
    { label: 'Rename', run: async () => { const name = prompt('Rename investigation', ws.name); if (name) { ws.name = name.slice(0, 80); await saveNow(); await refreshWorkspaceList(); } } },
    '-',
    { label: 'Export graph (JSON)', run: () => download(`${slug()}.json`, JSON.stringify(serialize(), null, 1), 'application/json') },
    { label: 'Export entities (CSV)', run: exportCsv },
    { label: 'Export image (PNG)', run: () => download(`${slug()}.png`, cy.png({ full: true, scale: 2, bg: BG })) },
    { label: 'Import graph (JSON)…', run: () => $('#file-json').click() },
    '-',
    { label: 'Delete investigation', danger: true, run: async () => {
      if (!confirm(`Delete "${ws.name}" and everything in it? This cannot be undone.`)) return;
      await api(`/api/workspaces/${ws.id}`, { method: 'DELETE' });
      ws = null;
      const list = await refreshWorkspaceList();
      if (list.length) await openWorkspace(list[0].id); else await createWorkspace('Investigation 1');
    } },
  ]);
}

// ---- adding things ------------------------------------------------------------------------------
function addManual(type, value, extra = {}) {
  if (type === 'auto') type = detectType(value);
  const r = upsert({ type, value, ...extra }, null, 'manual');
  if (!r) { log(`"${value}" is not a valid ${TYPES[type].label.toLowerCase()}.`, 'err'); return null; }
  afterChange(r.isNew ? [r.key] : []);
  focusNode(node(r.key));
  if (!r.isNew) log(`${node(r.key).data('display')} is already in the graph.`, 'note');
  return r.key;
}

// ---- events -------------------------------------------------------------------------------------
cy.on('select unselect', 'node', () => { refreshEdgeLabels(); renderDetails(); });
cy.on('tap', (e) => { closeMenu(); if (e.target === cy) clearPath(); });
cy.on('mouseover', 'node', (e) => refreshEdgeLabels(e.target));
cy.on('mouseout', 'node', () => refreshEdgeLabels());
cy.on('dragfree', 'node', scheduleSave);
cy.on('cxttap', 'node', (e) => {
  if (!e.target.selected()) { cy.elements().unselect(); e.target.select(); }
  const p = e.originalEvent;
  nodeMenu(e.target, p.clientX, p.clientY);
});
$('#cy').addEventListener('contextmenu', (e) => e.preventDefault());

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#add-value');
  const v = input.value.trim();
  if (!v) return;
  if (addManual($('#add-type').value, v)) { input.value = ''; $('#add-type').options[0].textContent = 'Auto-detect'; }
});
$('#add-value').addEventListener('input', (e) => {
  const sel = $('#add-type');
  sel.options[0].textContent = e.target.value.trim() ? `Auto: ${TYPES[detectType(e.target.value)].label}` : 'Auto-detect';
});

$('#search').addEventListener('input', applySearch);
$('#search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const hits = applySearch();
  if (hits?.length) cy.animate({ fit: { eles: hits, padding: 90 } }, { duration: 300 });
});

$('#btn-layout').addEventListener('click', () => runLayout());
$('#layout-select').addEventListener('change', () => runLayout());
$('#btn-fit').addEventListener('click', () => cy.animate({ fit: { eles: cy.elements().not('.hidden'), padding: 60 } }, { duration: 300 }));
$('#btn-clear-log').addEventListener('click', () => $('#log').replaceChildren());
$('#ws-menu-btn').addEventListener('click', (e) => { e.stopPropagation(); workspaceMenu(e.currentTarget); });
$('#ws-select').addEventListener('change', (e) => openWorkspace(e.target.value));
$('#file-json').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });

$('#btn-templates').addEventListener('click', openTemplates);
$('#btn-templates-2').addEventListener('click', openTemplates);
$('#tpl-close').addEventListener('click', () => $('#dlg-templates').close());
$('#btn-upload').addEventListener('click', () => $('#file-photo').click());
$('#file-photo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    const key = addManual('photo', j.value, { label: f.name });
    if (key) runModule(key, 'photo_analyze');
  } catch (err) { log(`Upload failed: ${err.message}`, 'err'); }
});

$('#btn-import-text').addEventListener('click', () => { $('#text-input').value = ''; $('#dlg-text').showModal(); });
$('#dlg-text').addEventListener('close', async (e) => {
  const text = $('#text-input').value;
  if (e.target.returnValue !== 'ok' || !text.trim()) return;
  try {
    const { entities } = await api('/api/extract', { method: 'POST', body: { text } });
    const added = [];
    cy.batch(() => entities.forEach((ent) => { const r = upsert(ent, null, 'text'); if (r?.isNew) added.push(r.key); }));
    afterChange(added);
    log(`Text extraction: ${entities.length} entities found, ${added.length} new.`);
    if (added.length) { cy.elements().unselect(); added.forEach((k) => node(k).select()); }
  } catch (err) { log(`Extraction failed: ${err.message}`, 'err'); }
});

$('#btn-settings').addEventListener('click', async () => {
  const s = await api('/api/settings');
  $('#set-github').value = '';
  $('#set-github-state').textContent = s.githubToken ? 'A token is saved. Enter a new one to replace it.' : 'No token saved.';
  $('#dlg-settings').showModal();
});
$('#dlg-settings').addEventListener('close', async (e) => {
  const v = $('#set-github').value.trim();
  if (e.target.returnValue === 'ok' && v) { await api('/api/settings', { method: 'PUT', body: { githubToken: v } }); log('Settings saved.'); }
});

$('#link-demo').addEventListener('click', async (e) => {
  e.preventDefault();
  const demo = await (await fetch('/demo.json')).json();
  await createWorkspace(demo.name, demo);
});

document.addEventListener('click', (e) => { if (!$('#ctx').contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  if (e.key === 'Escape') { closeMenu(); clearPath(); if (!typing) cy.elements().unselect(); }
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected().length) { e.preventDefault(); removeNodes(selected()); }
  if (e.key === '/') { e.preventDefault(); $('#add-value').focus(); }
});
window.addEventListener('pagehide', () => { if (ws) fetch(`/api/workspaces/${ws.id}`, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(serialize()) }); });

// ---- start --------------------------------------------------------------------------------------
async function init() {
  $('#add-type').replaceChildren(h('option', { value: 'auto' }, 'Auto-detect'), ...Object.entries(TYPES).map(([k, t]) => h('option', { value: k }, t.label)));
  $('#examples').replaceChildren(...[['domain', 'example.com'], ['person', 'Ada Lovelace'], ['username', 'torvalds'], ['email', 'someone@example.org'], ['ip', '8.8.8.8']]
    .map(([type, value]) => h('button', { onclick: () => addManual(type, value) }, chip(type), value)));
  modules = (await api('/api/meta')).modules;
  const list = await refreshWorkspaceList();
  let last = null;
  try { last = localStorage.getItem('communis.ws'); } catch { /* storage unavailable */ }
  if (!list.length) await createWorkspace('Investigation 1');
  else await openWorkspace(list.some((w) => w.id === last) ? last : list[0].id);
  renderDetails();
}
init().catch((e) => log(`Could not start: ${e.message}`, 'err'));
