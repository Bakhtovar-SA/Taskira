// Generates src/assets/atmosphere/grain.png — a seamless 160×160 grayscale
// noise tile for the atmosphere layer (ТЗ 5.3 «Решения гейта»: готовая плитка
// в сборке, а не живой SVG-фильтр). Deterministic (seeded) so re-running the
// script produces a byte-identical file. Run: node scripts/generate-grain.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 160;
let seed = 0x7a5c1d;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);

const raw = Buffer.alloc((SIZE + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    // Sum of two uniforms → soft triangular distribution around mid-grey:
    // fewer harsh black/white specks than plain uniform noise.
    const v = (rand() + rand()) / 2;
    raw[y * (SIZE + 1) + 1 + x] = Math.round(v * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // colour type: greyscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../src/assets/atmosphere/grain.png", import.meta.url), png);
console.log(`grain.png: ${png.length} bytes`);
