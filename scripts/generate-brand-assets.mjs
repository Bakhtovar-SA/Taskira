#!/usr/bin/env node
// ТЗ 5.5 — файлы знака «Отметка» (ADR-0016): SVG-мастера, фавикон svg+ico,
// apple-touch и иконки PWA 192/512. Геометрия — та же, что в <Logo>
// (src/icons.tsx); меняете знак — меняйте оба места и перезапускайте скрипт.
//
// PNG рендерит headless Chromium через playwright-core (в репозиторий как
// зависимость не добавлен — это разовая генерация, файлы лежат в public/):
//   SPIKE_NODE_MODULES=/path/to/node_modules CHROMIUM_PATH=/path/to/chrome \
//   node scripts/generate-brand-assets.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const PUB = new URL("../public/", import.meta.url);
const PLATE_A = "#a272f5"; // oklch(0.66 0.19 300)
const PLATE_B = "#4834c4"; // oklch(0.45 0.21 278)
const INK = "#fbfbff"; // oklch(0.99 0.006 288)
const BRAND = "#6b45d9"; // oklch(0.52 0.2 288)

const mark = (color) =>
  `<g fill="none" stroke="${color}" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.05h18"/><path d="M5.86 14.6 9.68 18.94 15.08 5.05"/></g>`;

/** Иконка приложения. rounded=false — квадрат в край (iOS/Android сами
 *  скругляют маской, иначе получится «плашка в плашке»). */
const appIcon = (rounded = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${PLATE_A}"/><stop offset="1" stop-color="${PLATE_B}"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="32" height="32" rx="${rounded ? 9 : 0}" fill="url(#p)"/>
  <rect width="32" height="32" rx="${rounded ? 9 : 0}" fill="url(#s)"/>
  ${rounded ? '<rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="#fff" stroke-opacity=".18"/>' : ""}
  <g fill="none" stroke="${INK}" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 9.4h17"/><path d="M10.2 18.4 13.8 22.5 18.9 9.4"/></g>
</svg>
`;

const markSvg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${mark(color)}</svg>\n`;

writeFileSync(new URL("favicon.svg", PUB), appIcon(true));
writeFileSync(new URL("logo-mark.svg", PUB), markSvg(BRAND));
writeFileSync(new URL("logo-mark-mono.svg", PUB), markSvg("currentColor").replace("<svg ", '<svg fill="none" '));
writeFileSync(
  new URL("manifest.webmanifest", PUB),
  JSON.stringify(
    {
      name: "Taskira",
      short_name: "Taskira",
      start_url: "/",
      display: "standalone",
      background_color: "#f3f2f9",
      theme_color: "#6b45d9",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  ) + "\n",
);

const require = createRequire(process.env.SPIKE_NODE_MODULES ? `${process.env.SPIKE_NODE_MODULES}/` : import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.log("SVG и manifest записаны. Для PNG/ICO задайте SPIKE_NODE_MODULES (с playwright-core) и CHROMIUM_PATH.");
  process.exit(0);
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
const out = {};
for (const [name, svg, size] of [
  ["icon-192.png", appIcon(true), 192],
  ["icon-512.png", appIcon(true), 512],
  ["icon-maskable-512.png", appIcon(false), 512],
  ["apple-touch-icon.png", appIcon(false), 180],
  ["ico-16", appIcon(true), 16],
  ["ico-32", appIcon(true), 32],
  ["ico-48", appIcon(true), 48],
]) {
  out[name] = await png(svg, size);
  if (name.endsWith(".png")) writeFileSync(new URL(name, PUB), out[name]);
}
await browser.close();

// ICO с PNG-кадрами 16/32/48 (формат Vista+, поддерживается всеми браузерами).
const frames = [
  [16, out["ico-16"]],
  [32, out["ico-32"]],
  [48, out["ico-48"]],
];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = 6 + 16 * frames.length;
const dir = [];
for (const [size, buf] of frames) {
  const e = Buffer.alloc(16);
  e[0] = size;
  e[1] = size;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  dir.push(e);
}
writeFileSync(new URL("favicon.ico", PUB), Buffer.concat([header, ...dir, ...frames.map((f) => f[1])]));
console.log("brand assets written to public/");
