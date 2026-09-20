/* Apply the saved theme before CSS loads. Kept external for CSP script-src 'self'. */
(function () {
  try {
    var theme = localStorage.getItem("taskira.theme");
    var dark = theme === "dark" ||
      (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (_) {
    // Storage or matchMedia can be unavailable; the light :root palette remains.
  }
})();
