import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { http } from './http.js';

export const DATA_DIR = path.resolve(process.env.COMMUNIS_DATA || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Bytes of a photo entity: an uploaded file (upload://name) or a remote image. */
export async function loadImage(value, fetcher = http) {
  let buf;
  if (value.startsWith('upload://')) {
    const name = value.slice(9);
    if (!/^[a-z0-9]+\.[a-z]+$/.test(name)) throw new Error('Bad upload reference');
    buf = await readFile(path.join(UPLOAD_DIR, name));
  } else {
    buf = (await fetcher.raw(value, { maxBytes: 10_000_000, headers: { accept: 'image/*' } })).buf;
  }
  const mime = sniff(buf);
  if (!mime) throw new Error('Not a supported image (JPEG, PNG, GIF or WebP)');
  return { buf, mime };
}

/** Minimal EXIF reader: camera, software, timestamps and GPS position from a JPEG. */
export function readExif(buf) {
  let off = 2;
  while (off + 4 < buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xe1 && buf.subarray(off + 4, off + 10).toString('latin1') === 'Exif\0\0') return parseTiff(buf.subarray(off + 10, off + 2 + len));
    if (marker === 0xda) break;
    off += 2 + len;
  }
  return {};
}

function parseTiff(t) {
  const le = t.subarray(0, 2).toString('latin1') === 'II';
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  const ifd = (start) => {
    const tags = {};
    if (!start || start + 2 > t.length) return tags;
    const n = u16(start);
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (SIZE[type] || 0) * count;
      const at = size > 4 ? u32(e + 8) : e + 8;
      if (!size || at + size > t.length) continue;
      if (type === 2) tags[tag] = t.subarray(at, at + count).toString('latin1').replace(/\0.*$/, '').trim();
      else if (type === 3) tags[tag] = u16(at);
      else if (type === 4) tags[tag] = u32(at);
      else if (type === 5) tags[tag] = Array.from({ length: count }, (_, k) => u32(at + k * 8) / (u32(at + k * 8 + 4) || 1));
    }
    return tags;
  };
  try {
    const main = ifd(u32(4));
    const exif = ifd(main[0x8769]);
    const gps = ifd(main[0x8825]);
    const out = { make: main[0x010f], model: main[0x0110], software: main[0x0131], taken: exif[0x9003] || main[0x0132], lens: exif[0xa434] };
    const dms = (v, ref) => (Array.isArray(v) && v.length === 3 ? (v[0] + v[1] / 60 + v[2] / 3600) * (/[SW]/i.test(ref || '') ? -1 : 1) : null);
    const lat = dms(gps[2], gps[1]);
    const lon = dms(gps[4], gps[3]);
    if (lat != null && lon != null && (lat || lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { out.lat = +lat.toFixed(6); out.lon = +lon.toFixed(6); }
    return out;
  } catch { return {}; }
}

/** Decode to RGBA. Only JPEG and PNG are supported. */
export function decodeImage(buf, mime) {
  if (mime === 'image/jpeg') return jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512, maxResolutionInMP: 60 });
  if (mime === 'image/png') return PNG.sync.read(buf);
  return null;
}

/**
 * Perceptual "difference hash": 64 bits describing the brightness gradients of the picture.
 * Re-encoded or resized copies of the same picture get (nearly) the same hash.
 */
export function fingerprint(buf, mime) {
  const out = { sha256: createHash('sha256').update(buf).digest('hex') };
  let img;
  try { img = decodeImage(buf, mime); } catch { return out; }
  if (!img?.width) return out;
  out.width = img.width;
  out.height = img.height;
  const W = 9, H = 8;
  const gray = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // average every source pixel that falls into this cell
      const x0 = Math.floor((x * img.width) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
      const y0 = Math.floor((y * img.height) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
      const sx = Math.max(1, Math.floor((x1 - x0) / 32)), sy = Math.max(1, Math.floor((y1 - y0) / 32));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy += sy) {
        for (let xx = x0; xx < x1; xx += sx) {
          const i = (yy * img.width + xx) * 4;
          sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
          n++;
        }
      }
      gray[y * W + x] = sum / n;
    }
  }
  let bits = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) bits += gray[y * W + x] > gray[y * W + x + 1] + 2 ? '1' : '0'; // +2: flat areas must not flip on rounding noise
  out.phash = BigInt(`0b${bits}`).toString(16).padStart(16, '0');
  return out;
}
