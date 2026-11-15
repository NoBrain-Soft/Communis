import { loadImage, readExif, fingerprint } from '../lib/images.js';
import { detectFaces, saveFaceCrop } from '../lib/faces.js';

/** Photo entities for the faces in a picture. A picture that is itself one portrait needs no separate crop. */
async function faceEntities(img, faces, fromKey, label) {
  const out = [];
  const closeUp = faces.length === 1 && faces[0].size > Math.min(img.width, img.height) * 0.3;
  if (closeUp) return out;
  for (const [i, f] of faces.slice(0, 8).entries()) {
    out.push({ type: 'photo', value: await saveFaceCrop(img, f), label: `${label} ${i + 1}`, rel: 'face in picture', from: fromKey, props: { kind: 'face crop', detection_score: f.score } });
  }
  return out;
}

export default [
  {
    id: 'photo_analyze', name: 'Analyse photo', group: 'Media', source: 'image file',
    description: 'Reads hidden metadata (GPS position, camera, date), finds and cuts out faces, and fingerprints the picture so copies of it link together.',
    inputs: ['photo'],
    async run({ value, props }, ctx) {
      const { buf, mime } = await loadImage(value, ctx.http);
      const fp = fingerprint(buf, mime);
      const exif = mime === 'image/jpeg' ? readExif(buf) : {};
      const entities = [];
      const notes = [];
      if (exif.lat != null) {
        entities.push({ type: 'location', value: `${exif.lat.toFixed(5)}, ${exif.lon.toFixed(5)}`, rel: 'taken at', props: { lat: exif.lat, lon: exif.lon, precision: 'GPS position embedded in the photo' } });
      } else notes.push('No GPS position embedded (most social networks strip it on upload).');
      const camera = [exif.make, exif.model && !exif.model.startsWith(exif.make || '\0') ? exif.model : exif.model?.replace(exif.make, '').trim() || exif.model].filter(Boolean).join(' ').trim();
      if (camera) entities.push({ type: 'technology', value: camera, rel: 'taken with' });
      let faces = [];
      if (props?.kind !== 'face crop') {
        const d = detectFaces(buf, mime);
        faces = d.faces;
        if (d.img && faces.length) entities.push(...await faceEntities(d.img, faces, null, 'Face'));
      }
      return {
        entities, notes,
        props: { format: mime.split('/')[1], size_kb: Math.round(buf.length / 1024), width: fp.width, height: fp.height, faces: props?.kind === 'face crop' ? undefined : faces.length, taken: exif.taken, software: exif.software, sha256: fp.sha256, phash: fp.phash },
      };
    },
  },
  {
    id: 'page_images', name: 'Pictures of people on this page', group: 'Media', source: 'target site', active: true, auto: false,
    description: 'Downloads the pictures shown on the page and keeps those that contain faces; faces in group pictures are cut out individually.',
    inputs: ['domain', 'url', 'profile'],
    async run({ type, value }, ctx) {
      const pageUrl = type === 'domain' ? `https://${value}/` : value;
      const r = await ctx.http.raw(pageUrl, { maxBytes: 1_500_000, headers: { accept: 'text/html,*/*;q=0.8' } });
      const html = r.buf.toString('utf8');
      const base = r.url || pageUrl;
      const urls = new Map();
      const add = (src, alt) => {
        if (!src || /^data:/i.test(src) || /\.svg(\?|$)/i.test(src) || /logo|icon|sprite|spacer|placeholder|pixel|badge|flag/i.test(src)) return;
        try { const u = new URL(src.replace(/&amp;/g, '&'), base).href; if (!urls.has(u)) urls.set(u, alt || ''); } catch { /* bad URL */ }
      };
      for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
        const at = (n) => m[0].match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
        if (+at('width') > 0 && +at('width') < 60) continue;
        // lazy-loading pages keep a placeholder in src; the real picture is in data-src / data-srcset (largest first or by width)
        const set = (at('data-srcset') || at('srcset') || '').split(',').map((c) => c.trim().split(/\s+/)).filter((c) => c[0]).sort((x, y) => (parseInt(y[1], 10) || 0) - (parseInt(x[1], 10) || 0));
        const mid = set.find((c) => (parseInt(c[1], 10) || 0) <= 1000) || set[0];
        add(at('data-src') || at('data-lazy-src') || (mid && mid[0]) || at('src'), at('alt') || at('title'));
      }
      for (const m of html.matchAll(/<meta[^>]+(?:og:image|twitter:image)[^>]*content\s*=\s*["']([^"']+)["']/gi)) add(m[1], '');
      const list = [...urls.entries()].slice(0, 16);
      const entities = [];
      let checked = 0;
      const work = async ([u, alt]) => {
        let img;
        try { img = await loadImage(u, ctx.http); } catch { return; }
        checked++;
        const { faces, img: px } = detectFaces(img.buf, img.mime);
        if (!faces.length || !px) return;
        const fp = fingerprint(img.buf, img.mime);
        const label = alt.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim().slice(0, 60) || (faces.length > 1 ? `Group picture (${faces.length} faces)` : 'Portrait');
        entities.push({ type: 'photo', value: u, label, rel: 'picture with faces', props: { faces: faces.length, alt_text: alt.trim() || undefined, width: px.width, height: px.height, sha256: fp.sha256, phash: fp.phash } });
        entities.push(...await faceEntities(px, faces, `photo:${u}`, 'Face'));
      };
      for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(work));
      const withFaces = entities.filter((e) => e.rel === 'picture with faces').length;
      return { entities, notes: [`Checked ${checked} of ${urls.size} pictures on the page; ${withFaces} contain faces.`, 'Face detection finds frontal faces; it does not identify who they are.'] };
    },
  },
];
