/**
 * Render generated terrain to PNG files for a quick look, without a browser.
 *   npm run terrain -- <out.png> [seed] ['{"landShare":0.4}']
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { N } from '../src/sim/grid';
import { defaultParams } from '../src/sim/params';
import { generateTerrain } from '../src/sim/terrain';

const out = process.argv[2] ?? 'terrain.png';
const seed = Number(process.argv[3] ?? 1);
const p = { ...defaultParams, ...JSON.parse(process.argv[4] ?? '{}') };
const t = generateTerrain(seed, p);

const S = 4; // pixels per cell
const W = N * S;
const raw = Buffer.alloc((W * 3 + 1) * W);
for (let py = 0; py < W; py++) {
  raw[py * (W * 3 + 1)] = 0;
  for (let px = 0; px < W; px++) {
    const i = ((py / S) | 0) * N + ((px / S) | 0);
    let r: number, g: number, b: number;
    if (t.water[i]) [r, g, b] = [70, 130, 180];
    else {
      const h = Math.min(1, t.elevation[i] / Math.max(p.relief, 1));
      [r, g, b] = [150 + 90 * h, 170 + 60 * h, 110 + 110 * h];
    }
    const o = py * (W * 3 + 1) + 1 + px * 3;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
let water = 0;
for (let i = 0; i < t.water.length; i++) water += t.water[i];
console.log(`${out}: water ${(100 * water / t.water.length).toFixed(1)} %`);
