/* Puzzullu — overview page. For now only the totals from data.json; the full list comes in 0.3.0. */
(function () {
  "use strict";

  const { esc, getal, data } = window.PZ;
  const tiles = document.getElementById("tiles");

  data()
    .then((d) => {
      const inBezit = d.exemplaren.filter((e) => e.eigenaren.length && !e.weg);
      const gelegd = new Set(d.logs.map((l) => l.exemplaar));
      const afbeeldingen = new Set(inBezit.map((e) => e.afbeelding));
      const stukjesPer = Object.fromEntries(d.exemplaren.map((e) => [e.id, e.stukjes || 0]));
      const tegels = [
        [inBezit.length, "puzzels in bezit"],
        [afbeeldingen.size, "verschillende afbeeldingen"],
        [d.logs.length, "keer gelegd"],
        [d.logs.reduce((n, l) => n + stukjesPer[l.exemplaar], 0), "stukjes gelegd"],
        [gelegd.size, "verschillende dozen gelegd"],
      ];
      tiles.innerHTML = tegels.map(([n, label]) => `<li class="tile"><b>${esc(getal(n))}</b><span>${esc(label)}</span></li>`).join("");
      const t = new Date(d.updated);
      document.getElementById("updated").textContent =
        `Bijgewerkt uit de Sheet op ${t.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })} om ${t.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
    })
    .catch(() => { tiles.innerHTML = `<li class="empty">De gegevens konden niet worden geladen. Probeer het over een paar minuten opnieuw.</li>`; });
})();
