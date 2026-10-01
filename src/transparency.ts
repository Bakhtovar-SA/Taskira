/** Personal choice wins; organization defaults respect high contrast. */
export type Transparency = "auto" | "on" | "off";
export type TransparencyDefault = "auto" | "on";
// resolveTransparency:start
export function resolveTransparency(personal: Transparency, org: TransparencyDefault, reducedTransparency: boolean, contrastMore: boolean): "on" | "off" {
  if (personal === "on" || personal === "off") return personal;
  if (contrastMore) return "off";
  if (org === "on") return "on";
  return reducedTransparency ? "off" : "on";
}
// resolveTransparency:end
export const REDUCED_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";
export const CONTRAST_MORE = "(prefers-contrast: more)";
export function systemTransparency(): number {
  try {
    return (window.matchMedia(REDUCED_TRANSPARENCY).matches ? 1 : 0) | (window.matchMedia(CONTRAST_MORE).matches ? 2 : 0);
  } catch { return 0; }
}
export function watchSystemTransparency(onChange: () => void): () => void {
  try {
    const queries = [REDUCED_TRANSPARENCY, CONTRAST_MORE].map((q) => window.matchMedia(q));
    queries.forEach((q) => q.addEventListener("change", onChange));
    return () => queries.forEach((q) => q.removeEventListener("change", onChange));
  } catch { return () => {}; }
}
