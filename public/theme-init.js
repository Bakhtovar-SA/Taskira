/* Apply the saved theme and atmosphere before CSS loads (no flash).
   Kept external for CSP script-src 'self'. Mirrors applyTheme() in src/theme.ts. */
(function () {
  // resolveTransparency:start
  function resolveTransparency(personal, org, reducedTransparency, contrastMore) {
    if (personal === "on" || personal === "off") return personal;
    if (contrastMore) return "off";
    if (org === "on") return "on";
    return reducedTransparency ? "off" : "on";
  }
  // resolveTransparency:end
  var root = document.documentElement;
  var personal = "auto", org = "auto";
  try {
    personal = localStorage.getItem("taskira.transparency");
    var theme = localStorage.getItem("taskira.theme");
    var skinBase = { dusk: "dark", graphite: "dark", dawn: "light", paper: "light" };
    var dark = skinBase[theme] ? skinBase[theme] === "dark" : theme === "dark" ||
      (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    if (skinBase[theme]) root.setAttribute("data-skin", theme);
    var bg = localStorage.getItem("taskira.bg");
    if (bg && bg !== "default") root.setAttribute("data-atmosphere", bg);
    if (localStorage.getItem("taskira.density") === "compact") root.setAttribute("data-density", "compact");
    // Оттенок бренда (ТЗ 5.14 п.5, src/brand.ts): CSSOM, не style="" — CSP style-src-attr 'none'.
    var brand = JSON.parse(localStorage.getItem("taskira.brand") || "null");
    if (brand && typeof brand.hue === "number" && brand.hue >= 255 && brand.hue <= 320) root.style.setProperty("--brand-h", String(brand.hue));
    org = brand && brand.transparencyDefault === "on" ? "on" : "auto";
    if (brand && typeof brand.name === "string") document.title = brand.name;
  } catch (_) {
    // Storage or matchMedia can be unavailable; the light :root palette remains.
  }
  var reduced = false, contrast = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
    contrast = window.matchMedia("(prefers-contrast: more)").matches;
  } catch (_) {}
  root.setAttribute("data-transparency", resolveTransparency(personal, org, reduced, contrast));
})();
