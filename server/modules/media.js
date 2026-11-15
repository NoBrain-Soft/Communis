import { loadImage, readExif, fingerprint } from '../lib/images.js';

export default [
  {
    id: 'photo_analyze', name: 'Analyse photo', group: 'Media', source: 'image file',
    description: 'Reads hidden metadata (GPS position, camera, date) and fingerprints the picture so copies of it link together.',
    inputs: ['photo'],
    async run({ value }, ctx) {
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
      return {
        entities, notes,
        props: { format: mime.split('/')[1], size_kb: Math.round(buf.length / 1024), width: fp.width, height: fp.height, taken: exif.taken, software: exif.software, sha256: fp.sha256, phash: fp.phash },
      };
    },
  },
];
