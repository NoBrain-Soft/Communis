// Communis server: static UI, workspace storage and the module runner.
import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile, readdir, unlink, rename } from 'node:fs/promises';
import { TYPES, normalize, keyOf } from '../shared/entities.js';
import { http as fetcher } from './lib/http.js';
import { extractFromText } from './lib/extract.js';
import { DATA_DIR, UPLOAD_DIR, loadImage, sniff } from './lib/images.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WS_DIR = path.join(DATA_DIR, 'workspaces');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PORT = Number(process.env.PORT) || 4780;
const HOST = process.env.HOST || '127.0.0.1';

const VENDOR = {
  'cytoscape.js': 'node_modules/cytoscape/dist/cytoscape.min.js',
  'layout-base.js': 'node_modules/layout-base/layout-base.js',
  'cose-base.js': 'node_modules/cose-base/cose-base.js',
  'cytoscape-fcose.js': 'node_modules/cytoscape-fcose/cytoscape-fcose.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

// ---- modules ---------------------------------------------------------------------------------
export async function loadModules() {
  const dir = path.join(ROOT, 'server/modules');
  const mods = new Map();
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.js')).sort()) {
    const exported = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    for (const m of [].concat(exported)) mods.set(m.id, m);
  }
  return mods;
}

/** Validate and normalise what a module returned so the UI can merge it blindly. */
export function finalize(input, result) {
  const selfKey = keyOf(input.type, input.value);
  const seen = new Map();
  for (const e of result.entities || []) {
    if (!TYPES[e.type]) continue;
    const value = normalize(e.type, e.value);
    const key = keyOf(e.type, e.value);
    if (!key) continue;
    const sep = e.from ? e.from.indexOf(':') : -1;
    const from = (sep > 0 && keyOf(e.from.slice(0, sep), e.from.slice(sep + 1))) || selfKey;
    if (key === from) continue;
    const props = Object.fromEntries(Object.entries(e.props || {}).filter(([, v]) => v != null && v !== ''));
    const edge = { rel: String(e.rel || 'related to').slice(0, 60), from, reverse: !!e.reverse };
    const prev = seen.get(key);
    if (prev) {
      Object.assign(prev.props, props);
      if (!prev.edges.some((x) => x.from === edge.from && x.rel === edge.rel)) prev.edges.push(edge);
    } else seen.set(key, { key, type: e.type, value, label: e.label ? String(e.label).slice(0, 120) : undefined, props, edges: key === selfKey ? [] : [edge] });
  }
  seen.delete(selfKey);
  return {
    entities: [...seen.values()],
    props: Object.fromEntries(Object.entries(result.props || {}).filter(([, v]) => v != null && v !== '')),
    notes: (result.notes || []).filter(Boolean),
  };
}

export async function runModule(mod, entity, settings, fetchImpl = fetcher) {
  const value = normalize(entity.type, entity.value);
  if (!value) throw new Error(`"${entity.value}" is not a valid ${TYPES[entity.type]?.label || entity.type}`);
  if (!mod.inputs.includes(entity.type)) throw new Error(`${mod.name} does not accept ${entity.type} entities`);
  const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5).map((x) => x.slice(0, 80)) : []);
  // what the graph already links this entity to; lets searches narrow down namesakes
  const input = { type: entity.type, value, props: entity.props || {}, context: { orgs: names(entity.context?.orgs), domains: names(entity.context?.domains),
    known: (Array.isArray(entity.context?.known) ? entity.context.known : []).filter((k) => ['person', 'organization', 'technology'].includes(k?.type) && typeof k.value === 'string').slice(0, 400).map((k) => ({ type: k.type, value: k.value.slice(0, 80) })) } };
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('The module took too long and was stopped')), 60000); });
  try {
    return finalize(input, await Promise.race([mod.run(input, { http: fetchImpl, settings }), timeout]));
  } finally { clearTimeout(timer); }
}

// ---- storage ---------------------------------------------------------------------------------
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
async function writeJson(file, data) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}
const wsFile = (id) => path.join(WS_DIR, `${id}.json`);
const validId = (id) => /^[a-z0-9]{8,24}$/.test(id);

async function getSettings() {
  const s = await readJson(SETTINGS_FILE, {});
  return { githubToken: s.githubToken || process.env.GITHUB_TOKEN || '', newsSites: s.newsSites || '', newsRegion: s.newsRegion || 'US:en' };
}

// ---- http helpers ----------------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : 'application/json', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...headers });
  res.end(data);
}
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function body(req, max = 20_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new ApiError(413, 'Request too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if (!/^application\/json/.test(req.headers['content-type'] || '')) throw new ApiError(415, 'Expected application/json');
  try { return JSON.parse((await body(req)).toString('utf8')); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, 'Invalid JSON'); }
}

async function serveStatic(res, file) {
  try {
    const data = await readFile(file);
    send(res, 200, data, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  } catch { send(res, 404, { error: 'Not found' }); }
}

// ---- routes ----------------------------------------------------------------------------------
async function api(req, res, url, modules) {
  const { pathname } = url;
  const m = req.method;

  if (pathname === '/api/meta' && m === 'GET') {
    return send(res, 200, { modules: [...modules.values()].map(({ run, ...meta }) => meta) });
  }

  if (pathname === '/api/run' && m === 'POST') {
    const { module: id, entity } = await jsonBody(req);
    const mod = modules.get(id);
    if (!mod || !entity?.type) throw new ApiError(400, 'Unknown module or missing entity');
    try { return send(res, 200, { ok: true, ...(await runModule(mod, entity, await getSettings())) }); }
    catch (e) { return send(res, 200, { ok: false, error: e.message || String(e) }); }
  }

  if (pathname === '/api/extract' && m === 'POST') {
    const { text } = await jsonBody(req);
    const { entities } = finalize({ type: 'phrase', value: '-' }, { entities: extractFromText(String(text || '').slice(0, 2_000_000)) });
    return send(res, 200, { entities });
  }

  if (pathname === '/api/upload' && m === 'POST') {
    const buf = await body(req, 12_000_000);
    const mime = sniff(buf);
    if (!mime) throw new ApiError(400, 'Only JPEG, PNG, GIF and WebP images can be uploaded');
    const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 24)}.${mime.split('/')[1]}`;
    await writeFile(path.join(UPLOAD_DIR, name), buf);
    return send(res, 200, { value: `upload://${name}` });
  }

  if (pathname === '/api/img' && m === 'GET') {
    const value = normalize('photo', url.searchParams.get('u'));
    if (!value) throw new ApiError(400, 'Bad image reference');
    try {
      const { buf, mime } = await loadImage(value);
      return send(res, 200, buf, { 'content-type': mime, 'cache-control': 'private, max-age=86400', 'content-security-policy': "default-src 'none'" });
    } catch (e) { throw new ApiError(502, e.message); }
  }

  if (pathname === '/api/settings') {
    if (m === 'GET') { const s = await getSettings(); return send(res, 200, { githubToken: !!s.githubToken, newsSites: s.newsSites, newsRegion: s.newsRegion }); }
    if (m === 'PUT') {
      const b = await jsonBody(req);
      const cur = await readJson(SETTINGS_FILE, {});
      if (typeof b.githubToken === 'string' && b.githubToken.trim()) cur.githubToken = b.githubToken.trim();
      if (typeof b.newsSites === 'string') cur.newsSites = b.newsSites.slice(0, 500);
      if (typeof b.newsRegion === 'string') cur.newsRegion = b.newsRegion.trim().slice(0, 10);
      await writeJson(SETTINGS_FILE, cur);
      return send(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/workspaces') {
    if (m === 'GET') {
      const list = [];
      for (const f of (await readdir(WS_DIR)).filter((n) => n.endsWith('.json'))) {
        const w = await readJson(path.join(WS_DIR, f), null);
        if (w) list.push({ id: w.id, name: w.name, updated: w.updated, nodes: w.nodes?.length || 0 });
      }
      return send(res, 200, list.sort((a, b) => (b.updated || '').localeCompare(a.updated || '')));
    }
    if (m === 'POST') {
      const b = await jsonBody(req);
      const w = { id: randomBytes(6).toString('hex'), name: String(b.name || 'Untitled investigation').slice(0, 80), updated: new Date().toISOString(), nodes: Array.isArray(b.nodes) ? b.nodes : [], edges: Array.isArray(b.edges) ? b.edges : [] };
      await writeJson(wsFile(w.id), w);
      return send(res, 200, w);
    }
  }

  // ---- shared index: where else does an entity appear? -----------------------------------------
  if (pathname === '/api/xref' && m === 'POST') {
    const b = await jsonBody(req);
    const wanted = new Set((Array.isArray(b.keys) ? b.keys : []).filter((k) => typeof k === 'string').slice(0, 5000));
    const hits = {};
    for (const f of (await readdir(WS_DIR)).filter((n) => n.endsWith('.json'))) {
      const w = await readJson(path.join(WS_DIR, f), null);
      if (!w || w.id === b.workspace) continue;
      const degree = new Map();
      for (const e of w.edges || []) { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); }
      for (const n of w.nodes || []) {
        const key = keyOf(n.type, n.value);
        if (!wanted.has(key) || n.props?.confidence === 'guess') continue;
        (hits[key] ||= []).push({ id: w.id, name: w.name, links: degree.get(key) || 0, notes: n.notes ? String(n.notes).slice(0, 200) : undefined });
      }
    }
    return send(res, 200, { hits });
  }
  const am = pathname.match(/^\/api\/workspaces\/([^/]+)\/around$/);
  if (am && m === 'GET') {
    if (!validId(am[1])) throw new ApiError(400, 'Bad workspace id');
    const w = await readJson(wsFile(am[1]), null);
    if (!w) throw new ApiError(404, 'Workspace not found');
    const key = url.searchParams.get('key');
    const edges = (w.edges || []).filter((e) => e.source === key || e.target === key);
    const near = new Set([key, ...edges.flatMap((e) => [e.source, e.target])]);
    return send(res, 200, { name: w.name, nodes: (w.nodes || []).filter((n) => near.has(keyOf(n.type, n.value))).map(({ x, y, ...n }) => n), edges });
  }

  const wm = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (wm) {
    if (!validId(wm[1])) throw new ApiError(400, 'Bad workspace id');
    const file = wsFile(wm[1]);
    if (m === 'GET') {
      const w = await readJson(file, null);
      if (!w) throw new ApiError(404, 'Workspace not found');
      return send(res, 200, w);
    }
    if (m === 'PUT') {
      const b = await jsonBody(req);
      const cur = await readJson(file, null);
      if (!cur) throw new ApiError(404, 'Workspace not found');
      const w = { id: cur.id, name: String(b.name || cur.name).slice(0, 80), updated: new Date().toISOString(), nodes: Array.isArray(b.nodes) ? b.nodes : cur.nodes, edges: Array.isArray(b.edges) ? b.edges : cur.edges };
      await writeJson(file, w);
      return send(res, 200, { ok: true, updated: w.updated });
    }
    if (m === 'DELETE') { await unlink(file).catch(() => {}); return send(res, 200, { ok: true }); }
  }
  throw new ApiError(404, 'Not found');
}

export async function createServer() {
  await mkdir(WS_DIR, { recursive: true });
  await mkdir(UPLOAD_DIR, { recursive: true });
  const modules = await loadModules();
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      // The API can make this machine send requests; when bound to loopback, refuse calls that come
      // from another site (DNS rebinding / cross-site requests).
      if (HOST === '127.0.0.1' || HOST === 'localhost') {
        const origin = req.headers.origin;
        if (!localHost.test(req.headers.host || '') || (origin && !localHost.test(origin.replace(/^https?:\/\//, '')))) return send(res, 403, { error: 'Forbidden' });
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, modules);
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      if (url.pathname.startsWith('/vendor/')) {
        const v = VENDOR[url.pathname.slice(8)];
        return v ? serveStatic(res, path.join(ROOT, v)) : send(res, 404, { error: 'Not found' });
      }
      const base = url.pathname.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
      const file = path.normalize(path.join(base, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
      if (!file.startsWith(base + path.sep)) return send(res, 403, { error: 'Forbidden' });
      return serveStatic(res, file);
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
      send(res, e.status || 500, { error: e instanceof ApiError ? e.message : 'Internal error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer();
  server.listen(PORT, HOST, () => console.log(`Communis is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
}
