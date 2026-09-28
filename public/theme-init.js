/* Apply the saved theme and atmosphere before CSS loads (no flash).
   Kept external for CSP script-src 'self'. Mirrors applyTheme() in src/theme.ts. */
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem("taskira.theme");
    var skinBase = { dusk: "dark", graphite: "dark", dawn: "light", paper: "light" };
    var dark = skinBase[theme] ? skinBase[theme] === "dark" : theme === "dark" ||
      (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    if (skinBase[theme]) root.setAttribute("data-skin", theme);
    var bg = localStorage.getItem("taskira.bg");
    if (bg && bg !== "default") root.setAttribute("data-atmosphere", bg);
    if (localStorage.getItem("taskira.density") === "compact") root.setAttribute("data-density", "compact");
  } catch (_) {
    // Storage or matchMedia can be unavailable; the light :root palette remains.
  }
})();
