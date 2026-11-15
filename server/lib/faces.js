// Face detection (Viola-Jones, via tracking.js) and cropping. Runs entirely on this machine.
import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import { decodeImage, UPLOAD_DIR } from './images.js';

let tracker = null;
function load() {
  if (tracker) return tracker;
  // tracking.js is a browser library; give it the few globals it expects and run it in its own context
  const dir = path.dirname(createRequire(import.meta.url).resolve('tracking/package.json'));
  const ctx = { navigator: {}, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['build/tracking.js', 'build/data/face.js']) vm.runInContext(readFileSync(path.join(dir, f), 'utf8'), ctx);
  tracker = ctx.tracking;
  return tracker;
}

/** Nearest-neighbour resample of an RGBA image region to w×h. */
function resample(img, sx, sy, sw, sh, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const yy = Math.min(img.height - 1, Math.floor(sy + ((y + 0.5) * sh) / h));
    for (let x = 0; x < w; x++) {
      const xx = Math.min(img.width - 1, Math.floor(sx + ((x + 0.5) * sw) / w));
      const s = (yy * img.width + xx) * 4, d = (y * w + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
    }
  }
  return out;
}

/** Faces in an image as [{ x, y, size, score }] in source pixels, strongest first. Empty for unsupported formats. */
export function detectFaces(buf, mime) {
  let img;
  try { img = decodeImage(buf, mime); } catch { return { faces: [], img: null }; }
  if (!img?.width || img.width < 48 || img.height < 48) return { faces: [], img };
  // The detector samples a sparse grid, so one pass can miss a face that another finds. Work at a fixed size,
  // run two passes with different grids and keep what they agree on.
  const scale = Math.min(3, 320 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const small = resample(img, 0, 0, img.width, img.height, w, h);
  const t = load();
  const merged = [];
  for (const [initial, factor, step] of [[1, 1.2, 1.5], [1, 1.1, 1]]) {
    let rects = [];
    try { rects = t.ViolaJones.detect(small, w, h, initial, factor, step, 0.2, t.ViolaJones.classifiers.face); } catch { rects = []; }
    for (const r of rects) {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const same = merged.find((m) => Math.abs(m.cx - cx) < m.size * 0.5 && Math.abs(m.cy - cy) < m.size * 0.5 && r.width / m.size > 0.5 && r.width / m.size < 2);
      if (same) { same.score += r.total; same.passes++; } else merged.push({ cx, cy, size: r.width, x: r.x, y: r.y, score: r.total, passes: 1 });
    }
  }
  const faces = merged.filter((m) => m.score >= 4).sort((a, b) => b.score - a.score).slice(0, 12)
    .map((m) => ({ x: Math.round(m.x / scale), y: Math.round(m.y / scale), size: Math.round(m.size / scale), score: m.score }));
  return { faces, img };
}

/** Cut a face (with some margin) out of a decoded image and store it as an uploaded photo. Returns its "upload://" value. */
export async function saveFaceCrop(img, face) {
  const pad = face.size * 0.35;
  const sx = Math.max(0, Math.round(face.x - pad)), sy = Math.max(0, Math.round(face.y - pad * 1.2));
  const sw = Math.min(img.width - sx, Math.round(face.size + pad * 2)), sh = Math.min(img.height - sy, Math.round(face.size + pad * 2.2));
  const k = Math.min(1, 200 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(resample(img, sx, sy, sw, sh, w, h));
  const out = PNG.sync.write(png);
  const name = `${createHash('sha256').update(out).digest('hex').slice(0, 24)}.png`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), out);
  return `upload://${name}`;
}
