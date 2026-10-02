import { BRAND_HUE, BRAND_EXTRA_HUES } from "../contract.js";
export interface MailBrand { name: string; accent: string }
const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export function whiteContrast(hex: string): number {
  const rgb = [1, 3, 5].map(i => linear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 1.05 / (0.05 + 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
}
/** Same profiles as tokens.css, with a second contrast check after sRGB quantization. */
export function mailAccent(hue: number | null): string {
  const h = typeof hue === "number" && Number.isInteger(hue) && ((hue >= BRAND_HUE.min && hue <= BRAND_HUE.max) || BRAND_EXTRA_HUES.some(v => v === hue)) ? hue : BRAND_HUE.default;
  const extra = BRAND_EXTRA_HUES.some(v => v === h);
  let L = extra && h !== 55 && h !== 345 ? 0.505 : 0.55;
  const C = extra ? 0.16 : 0.2;
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  for (;;) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const values = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    const hex = "#" + values.map(v => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))).toString(16).padStart(2, "0")).join("");
    if (whiteContrast(hex) >= 4.5) return hex;
    L -= 0.01;
  }
}
