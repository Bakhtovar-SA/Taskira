/* Apply the saved theme, atmosphere and texture before CSS loads (no flash).
   Kept external for CSP script-src 'self'. Mirrors applyTheme() in src/theme.ts. */
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem("taskira.theme");
    var dark = theme === "dark" ||
      (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    var bg = localStorage.getItem("taskira.bg");
    if (bg && bg !== "default") root.setAttribute("data-atmosphere", bg);
    root.setAttribute("data-texture", localStorage.getItem("taskira.texture") === "off" ? "off" : "on");
  } catch (_) {
    // Storage or matchMedia can be unavailable; the light :root palette remains.
  }
})();
