/* Puzzullu — helpers shared by all pages (window.PZ). */
(function () {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getal = new Intl.NumberFormat("nl-NL");

  // seconds -> "u:mm:ss" (1:01:00, 0:59:26)
  function tijd(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // "2026-07-03" -> "03-07-2026"
  function datum(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  }

  // rating 1–5 -> ★★★☆☆
  const sterren = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");

  let dataPromise = null;
  function data() {
    dataPromise = dataPromise || fetch("/data.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`data.json: ${r.status}`);
      return r.json();
    });
    return dataPromise;
  }

  window.PZ = { esc, getal: (n) => getal.format(n), tijd, datum, sterren, data };
})();
