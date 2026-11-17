/* Puzzullu — calculations shared by the statistics, the person page and the log page (window.PZR):
   data.json made ready for counting, and the calendar heatmap. Needs shared.js (window.PZ) first. */
(function () {
  "use strict";

  const { esc, datum } = window.PZ;
  const MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const DAG = ["zo", "ma", "di", "wo", "do", "vr", "za"];

  const naam = (a) => (a ? a.en || a.nl : "?");

  // every log with its box (e), picture (a), piece count, version, team and the pieces really laid (minus known missing)
  function voorbereiden(d) {
    const afb = Object.fromEntries(d.afbeeldingen.map((a) => [a.id, a]));
    const ex = Object.fromEntries(d.exemplaren.map((e) => [e.id, e]));
    const logs = d.logs.map((l) => {
      const e = ex[l.exemplaar] || {};
      const stukjes = e.stukjes || 0;
      return { ...l, e, a: afb[e.afbeelding], stukjes, versie: `${e.afbeelding}|${stukjes}`, team: l.makers.join("|"),
        gelegd: Math.max(0, stukjes - (typeof l.missend === "number" ? l.missend : 0)) };
    });
    const getimed = logs.filter((l) => l.sec != null && l.stukjes);
    const dozen = d.exemplaren.filter((e) => !e.weg);
    return { ...d, afb, ex, logs, getimed, dozen };
  }

  // a name that links to that person's page
  const mens = (m) => `<a class="mens" href="/persoon/?naam=${encodeURIComponent(m)}">${esc(m)}</a>`;
  // "Hanna", "Hanna & Igor", "Hanna, Igor & Simon", every name a link
  const mensen = (makers) => {
    const ls = makers.map(mens);
    return ls.length < 2 ? ls.join("") : `${ls.slice(0, -1).join(", ")} & ${ls[ls.length - 1]}`;
  };

  // ---------------------------------------------------------------- records
  // the fastest time per piece count and group size (Solo, Duo, Drie, Team = 4, 5 of meer); a tie goes to the first

  const GROEPEN = [[1, "Solo"], [2, "Duo"], [3, "Drie"], [4, "Team"], [5, "5 of meer"]];
  const groep = (l) => Math.min(l.makers.length, 5);

  function records(D) {
    const beste = new Map();
    for (const l of D.getimed) {
      const k = `${l.stukjes}|${groep(l)}`;
      const r = beste.get(k);
      if (!r || l.sec < r.sec || (l.sec === r.sec && (l.datum || "9") < (r.datum || "9"))) beste.set(k, l);
    }
    return [...beste].map(([k, l]) => ({ stukjes: l.stukjes, groep: groep(l), log: l }))
      .sort((x, y) => x.stukjes - y.stukjes || x.groep - y.groep);
  }

  // ---------------------------------------------------------------- week streak
  // A week (Monday to Sunday) counts when at least WEEK_STUKJES pieces were laid in it. The current streak still
  // runs while this week is not over yet; it breaks only after a Sunday without enough pieces.

  const WEEK_STUKJES = 1000;
  const dagNr = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
  const weekNr = (iso) => Math.floor((dagNr(iso) + 3) / 7); // 1-1-1970 was a Thursday: weeks start on Monday
  const vandaagIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function weekreeks(logs, vandaag = vandaagIso()) {
    const perWeek = new Map();
    for (const l of logs) if (l.datum) perWeek.set(weekNr(l.datum), (perWeek.get(weekNr(l.datum)) || 0) + l.gelegd);
    const goed = [...perWeek].filter(([, n]) => n >= WEEK_STUKJES).map(([w]) => w).sort((x, y) => x - y);
    let langste = 0, reeks = 0, eind = null;
    goed.forEach((w, i) => {
      reeks = i && w - goed[i - 1] === 1 ? reeks + 1 : 1;
      if (reeks > langste) { langste = reeks; eind = w; }
    });
    const deze = weekNr(vandaag), set = new Set(goed);
    let huidig = 0;
    for (let w = set.has(deze) ? deze : deze - 1; set.has(w); w -= 1) huidig += 1;
    const dezeWeek = perWeek.get(deze) || 0;
    return { langste, huidig, dezeWeek, nodig: Math.max(0, WEEK_STUKJES - dezeWeek), gehaald: set.has(deze),
      langsteTot: eind == null ? null : new Date((eind * 7 + 3) * 864e5).toISOString().slice(0, 10) };
  }

  // ---------------------------------------------------------------- calendar heatmap
  // One year: a row per month, a square per day (1-31); the more puzzles that day, the yellower.
  // Year chips on top (the last 4, older ones behind "Meer"); tapping a day shows its puzzles below.

  const KAL_JAREN = 4;
  const kleur = (n) => (n ? `rgba(255, 200, 69, ${[0, 0.38, 0.62, 0.82, 1][Math.min(n, 4)]})` : "#1e3563");

  function kalender(el, logs, tekst = "puzzels") {
    const metDatum = logs.filter((l) => l.datum);
    const jaren = [...new Set(metDatum.map((l) => l.datum.slice(0, 4)))].sort().reverse();
    if (!jaren.length) {
      el.innerHTML = '<p class="muted">Nog geen puzzels met een datum.</p>';
      return;
    }
    let jaar = jaren[0], oud = false;
    const perDag = new Map();
    for (const l of metDatum) {
      if (!perDag.has(l.datum)) perDag.set(l.datum, []);
      perDag.get(l.datum).push(l);
    }
    const vandaag = new Date().toISOString().slice(0, 10);

    const teken = () => {
      const toon = oud ? jaren : jaren.slice(0, KAL_JAREN);
      const chips = toon.map((j) => `<button type="button" class="chip" data-jaar="${j}" aria-pressed="${j === jaar}">${j}</button>`).join("")
        + (jaren.length > KAL_JAREN ? `<button type="button" class="chip meer" data-meer aria-expanded="${oud}">${oud ? "Minder ▴" : "Meer ▾"}</button>` : "");
      // a grid: the month name, then a square per day; day numbers 1, 5, 10, ... on top
      let cellen = '<span></span>' + Array.from({ length: 31 }, (_, i) => `<span class="kal-as">${i === 0 || (i + 1) % 5 === 0 ? i + 1 : ""}</span>`).join("");
      let n = 0, dagen = 0;
      for (let m = 0; m < 12; m += 1) {
        cellen += `<span class="kal-as kal-maand">${MAAND[m]}</span>`;
        const lengte = new Date(Date.UTC(Number(jaar), m + 1, 0)).getUTCDate();
        for (let d = 1; d <= 31; d += 1) {
          if (d > lengte) { cellen += "<span></span>"; continue; }
          const iso = `${jaar}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const ls = perDag.get(iso) || [];
          n += ls.length;
          dagen += ls.length > 0;
          const wd = DAG[new Date(`${iso}T12:00:00`).getDay()];
          cellen += iso > vandaag ? '<span class="kal-dag later"></span>'
            : `<span class="kal-dag" data-dag="${iso}" style="background:${kleur(ls.length)}" title="${wd} ${datum(iso)}: ${ls.length ? `${ls.length} ${ls.length === 1 ? "puzzel" : "puzzels"}` : "geen puzzel"}"></span>`;
        }
      }
      el.innerHTML = `<div class="chips jaren" role="group" aria-label="Jaar">${chips}</div>`
        + `<p class="muted klein">${n} ${tekst} op ${dagen} ${dagen === 1 ? "dag" : "dagen"} in ${jaar}. Tik op een dag om te zien wat er gelegd is.</p>`
        + `<div class="kal" role="img" aria-label="${n} ${tekst} op ${dagen} dagen in ${jaar}, per dag">${cellen}</div>`
        + `<div class="kal-legenda muted"><span>minder</span>${[0, 1, 2, 3, 4].map((x) => `<i style="background:${kleur(x)}"></i>`).join("")}<span>meer</span></div>`
        + '<p class="kal-detail" aria-live="polite"></p>';
      el.querySelector(".jaren").classList.toggle("open", oud);
    };

    el.addEventListener("click", (ev) => {
      const meer = ev.target.closest("[data-meer]");
      const chip = ev.target.closest("[data-jaar]");
      const dag = ev.target.closest("[data-dag]");
      if (meer) { oud = !oud; return teken(); }
      if (chip) { jaar = chip.dataset.jaar; return teken(); }
      if (!dag) return;
      for (const r of el.querySelectorAll(".kal-dag.gekozen")) r.classList.remove("gekozen");
      dag.classList.add("gekozen");
      const ls = perDag.get(dag.dataset.dag) || [];
      el.querySelector(".kal-detail").innerHTML = `<b>${DAG[new Date(`${dag.dataset.dag}T12:00:00`).getDay()]} ${datum(dag.dataset.dag)}</b>: `
        + (ls.length ? ls.map((l) => `${esc(naam(l.a))} <span class="muted">(${l.stukjes || "?"}, ${esc(l.makers.join(", "))})</span>`).join(" · ") : "geen puzzel");
    });
    teken();
  }

  window.PZR = { voorbereiden, kalender, naam, records, GROEPEN, groep, mens, mensen, weekreeks, WEEK_STUKJES, weekNr };
})();
