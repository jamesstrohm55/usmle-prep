// Removes EXIF/XMP/IPTC (APP1, APP13) segments from JPEGs in place: photographer GPS and device data should not ship in a public repo.
import fs from 'node:fs';
import { globSync } from 'node:fs';
let changed = 0;
for (const f of globSync('public/images/**/*.jpg')) {
  const b = fs.readFileSync(f);
  if (b[0] !== 0xff || b[1] !== 0xd8) continue;
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { out.push(b.subarray(i)); break; }
    const m = b[i + 1];
    if (m === 0xda) { out.push(b.subarray(i)); break; } // start of scan: rest is image data
    const len = b.readUInt16BE(i + 2);
    if (m !== 0xe1 && m !== 0xed) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const n = Buffer.concat(out);
  if (n.length !== b.length) { fs.writeFileSync(f, n); changed++; }
}
console.log('stripped', changed);
