/* Puzzullu — calculations shared by the statistics, the person page and the log page (window.PZR):
   data.json made ready for counting, and the calendar heatmap. Needs shared.js (window.PZ) first. */
(function () {
  "use strict";

  const { esc, datum, getal } = window.PZ;
  const MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const DAG = ["zo", "ma", "di", "wo", "do", "vr", "za"];

  const naam = (a) => (a ? a.en || a.nl : "?");

  // Expert puzzles (the JvH Expert series, 500 pieces but much harder) are a size of their own: "maat" is the piece
  // count, plus "e" for an expert version ("500e"), shown as "500 expert". Records, the progress chart, averages and the
  // prediction keep them apart from the normal 500.
  const isExpert = (a, stukjes) => !!(a && Array.isArray(a.expert) && a.expert.includes(stukjes));
  const maatNaam = (x) => `${getal(x.stukjes)}${x.expert ? " expert" : ""}`;
  // sort sizes: by piece count, the expert version right after the normal one
  const opMaat = (x, y) => x.stukjes - y.stukjes || x.expert - y.expert;

  // every log with its box (e), picture (a), piece count, size (maat), version, team and the pieces really laid
  // (minus known missing)
  function voorbereiden(d) {
    const afb = Object.fromEntries(d.afbeeldingen.map((a) => [a.id, a]));
    const ex = Object.fromEntries(d.exemplaren.map((e) => [e.id, e]));
    const logs = d.logs.map((l) => {
      const e = ex[l.exemplaar] || {};
      const stukjes = e.stukjes || 0, a = afb[e.afbeelding], expert = isExpert(a, stukjes);
      return { ...l, e, a, stukjes, expert, maat: `${stukjes}${expert ? "e" : ""}`, versie: `${e.afbeelding}|${stukjes}`, team: l.makers.join("|"),
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
      const k = `${l.maat}|${groep(l)}`;
      const r = beste.get(k);
      if (!r || l.sec < r.sec || (l.sec === r.sec && (l.datum || "9") < (r.datum || "9"))) beste.set(k, l);
    }
    return [...beste].map(([k, l]) => ({ stukjes: l.stukjes, expert: l.expert, maat: l.maat, groep: groep(l), log: l }))
      .sort((x, y) => opMaat(x, y) || x.groep - y.groep);
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

  // ---------------------------------------------------------------- prediction
  // How long will these people take on this puzzle? From the times of exactly this team on this piece count,
  // weighted towards their most recent ones (a Gaussian bell, VOORSPEL_DAGEN wide), corrected for difficulty:
  // per rating, how much slower or faster puzzles of that rating are than average (from all logs). With fewer than
  // 3 such times: all teams of the same size on this piece count, the makers' own teams counting 3 times as much
  // ("voorzichtige schatting"). The range is 1.3 times the spread of those times (at least 10% either way), so about two out of three times land in it.

  const VOORSPEL_DAGEN = 60; // tested on all our earlier times: half of them within 10% of the prediction

  function ratingFactoren(D) {
    if (D._rating) return D._rating;
    const groep = new Map(), per = new Map();
    for (const l of D.getimed) {
      const k = `${l.maat}|${groep_(l)}`;
      if (!groep.has(k)) groep.set(k, []);
      groep.get(k).push(Math.log(l.sec));
    }
    const gem = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
    const basis = new Map([...groep].map(([k, xs]) => [k, gem(xs)]));
    for (const l of D.getimed) {
      const r = (l.a && l.a.rating) || 0;
      if (!per.has(r)) per.set(r, []);
      per.get(r).push(Math.log(l.sec) - basis.get(`${l.maat}|${groep_(l)}`));
    }
    D._rating = new Map([...per].map(([r, xs]) => [r, xs.length >= 5 ? gem(xs) : 0]));
    // how much slower an expert 500 is than a normal 500 with as many people (for when there are no expert times yet)
    const extra = D.getimed.filter((l) => l.expert && basis.has(`${l.stukjes}|${groep_(l)}`))
      .map((l) => Math.log(l.sec) - basis.get(`${l.stukjes}|${groep_(l)}`));
    D._rating.expert = extra.length >= 3 ? gem(extra) : Math.log(1.4);
    return D._rating;
  }
  const groep_ = (l) => Math.min(l.makers.length, 5);

  // makers: sorted names; returns {sec, van, tot, n, voorzichtig} or null. An expert puzzle only looks at expert
  // times; with none at all for this many people, at normal times of that piece count, made slower by how much
  // slower expert puzzles are.
  function voorspel(D, afbeelding, stukjes, makers) {
    if (!stukjes || !makers.length) return null;
    const f = ratingFactoren(D), r = (a) => f.get((a && a.rating) || 0) || 0;
    const team = [...makers].sort((x, y) => x.localeCompare(y, "nl")).join("|");
    const expert = isExpert(D.afb[afbeelding], stukjes);
    let metDatum = D.getimed.filter((l) => l.datum && l.stukjes === stukjes && l.expert === expert), plus = 0;
    if (expert && !metDatum.some((l) => l.makers.length === makers.length)) {
      metDatum = D.getimed.filter((l) => l.datum && l.stukjes === stukjes && !l.expert);
      plus = f.expert;
    }
    let ls = metDatum.filter((l) => l.makers.join("|") === team), voorzichtig = !!plus;
    if (ls.length < 3) {
      ls = metDatum.filter((l) => l.makers.length === makers.length);
      voorzichtig = true;
    }
    if (!ls.length) return null;
    const nieuwst = Math.max(...ls.map((l) => dagNr(l.datum)));
    const ws = ls.map((l) => Math.exp(-0.5 * ((nieuwst - dagNr(l.datum)) / VOORSPEL_DAGEN) ** 2)
      * (voorzichtig && l.makers.some((m) => makers.includes(m)) ? 3 : 1));
    const vs = ls.map((l) => Math.log(l.sec) - r(l.a));
    const som = ws.reduce((n, w) => n + w, 0);
    const m = ws.reduce((n, w, i) => n + w * vs[i], 0) / som;
    const sd = 1.3 * Math.max(0.08, Math.sqrt(ws.reduce((n, w, i) => n + w * (vs[i] - m) ** 2, 0) / som));
    const doel = m + r(D.afb[afbeelding]) + plus;
    const rond = (x) => Math.round(x / 60) * 60;
    return { sec: rond(Math.exp(doel)), van: rond(Math.exp(doel - sd)), tot: rond(Math.exp(doel + sd)), n: ls.length, voorzichtig, expert, geschat: !!plus };
  }

  // "ongeveer 1:05 uur (tussen 0:58 en 1:12)", or "ongeveer 33 minuten (tussen 30 en 36)" under an hour
  function voorspelTekst(v) {
    const uur = v.tot >= 3600;
    const kort = (s) => (uur ? `${Math.floor(s / 3600)}:${String(Math.round(s / 60) % 60).padStart(2, "0")}` : `${Math.round(s / 60)}`);
    return `ongeveer <b>${kort(v.sec)} ${uur ? "uur" : "minuten"}</b> <span class="muted">(tussen ${kort(v.van)} en ${kort(v.tot)})</span>`;
  }

  // one line on how the prediction was made
  function voorspelUitleg(v, makers, stukjes) {
    const wie = makers.length === 1 ? makers[0] : "deze groep";
    if (v.geschat) return `Voorzichtige schatting: nog geen expert-tijden met ${makers.length === 1 ? "één persoon" : `${makers.length} mensen`}, dus gerekend met de gewone ${getal(stukjes)} stukjes, plus de extra tijd die een expertpuzzel kost.`;
    stukjes = `${getal(stukjes)} stukjes${v.expert ? " (expert)" : ""}`;
    return v.voorzichtig
      ? `Voorzichtige schatting: ${esc(wie)} ${makers.length === 1 ? "heeft" : "heeft samen"} nog geen 3 tijden op ${stukjes}, dus gerekend met ${makers.length === 1 ? "alle solotijden" : `alle groepen van ${makers.length}`}${v.expert ? " op expertpuzzels" : ""} (eigen tijden tellen zwaarder).`
      : `Gerekend met ${v.n} tijden van ${esc(wie)}${makers.length === 1 ? " solo" : ""} op ${stukjes} (de recente tellen het zwaarst) en de moeilijkheid van de puzzel.`;
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

  window.PZR = { voorbereiden, kalender, naam, records, GROEPEN, groep, mens, mensen, weekreeks, WEEK_STUKJES, weekNr, dagNr, voorspel, voorspelTekst, voorspelUitleg, isExpert, maatNaam, opMaat };
})();
