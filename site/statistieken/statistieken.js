/* Puzzullu — statistics (/statistieken/): totals, per year, per person, the collection, most done, fun facts,
   comparing a person or team (progress on 1000 pieces, against other teams of the same size), versions done often,
   and our best times against the winners of the NK. Everything is computed here from data.json.
   A team is exactly the same set of makers; times are only compared between the same number of people. */
(function () {
  "use strict";

  const { esc, getal, tijd, datum, data } = window.PZ;
  const $ = (id) => document.getElementById(id);
  const TEAM_KEY = "pz-stats-team";
  const MIN_TEAM = 3;      // timed logs a person or team needs to be in the dropdown
  const MIN_TREND = 5;     // timed 1000-piece logs needed for a trend
  const VAAK_MIN = 3;      // timed logs a version needs to be "vaak gelegd"
  const VAAK_TOON = 10;
  const NK_GROOTTE = { solo: 1, duo: 2, team: 4 };
  const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

  let D = null;

  // ---------------------------------------------------------------- helpers

  const naam = (a) => (a ? a.en || a.nl : "?");
  const som = (xs) => xs.reduce((n, x) => n + x, 0);
  const groepeer = (xs, key) => {
    const g = new Map();
    for (const x of xs) {
      const k = key(x);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(x);
    }
    return g;
  };
  // "Hanna", "Hanna & Igor", "Hanna, Igor & Simon"
  const wie = (makers) => (makers.length < 2 ? makers.join("") : `${makers.slice(0, -1).join(", ")} & ${makers[makers.length - 1]}`);
  const zijn = (makers) => (makers.length === 1 ? "is" : "zijn");

  // a duration in words: "18 minuten", "1 uur en 5 minuten", "40 seconden"
  function woorden(sec) {
    sec = Math.round(Math.abs(sec));
    const u = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60;
    if (u) return `${u} uur${m ? ` en ${m} ${m === 1 ? "minuut" : "minuten"}` : ""}`;
    if (m) return `${m} ${m === 1 ? "minuut" : "minuten"}`;
    return `${sec} seconden`;
  }
  const getal1 = (n) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

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

  // ---------------------------------------------------------------- tiles, facts

  function tegels() {
    const { dozen, logs } = D;
    const tegels = [
      [dozen.length, "dozen in de kast"],
      [new Set(dozen.map((e) => e.afbeelding)).size, "verschillende puzzels"],
      [som(dozen.map((e) => Math.max(0, (e.stukjes || 0) - (e.missend || 0)))), "stukjes in de kast"],
      [logs.length, "keer gelegd"],
      [som(logs.map((l) => l.gelegd)), "stukjes gelegd"],
      [Math.round(som(logs.map((l) => l.sec || 0)) / 3600), "uur gepuzzeld"],
    ];
    $("tiles").innerHTML = tegels.map(([n, label]) => `<li class="tile"><b>${esc(getal(n))}</b><span>${esc(label)}</span></li>`).join("");
  }

  function feitjes() {
    const { logs, getimed, dozen } = D;
    const f = [];
    const uren = som(logs.map((l) => l.sec || 0)) / 3600;
    f.push(`We hebben samen <b>${getal(Math.round(uren))} uur</b> gepuzzeld, alleen de keren met een tijd geteld. Dat is <b>${getal1(uren / 24)} dagen</b> non-stop.`);
    const stukjes = som(logs.map((l) => l.gelegd));
    f.push(`Alle <b>${getal(stukjes)}</b> stukjes die we ooit gelegd hebben, achter elkaar op een rij: <b>${getal1(stukjes * 0.018 / 1000)} kilometer</b>.`);

    const perPersoon = {};
    for (const l of logs) for (const m of l.makers) perPersoon[m] = (perPersoon[m] || 0) + l.gelegd;
    const [kampioen, kStukjes] = Object.entries(perPersoon).sort((x, y) => y[1] - x[1])[0] || [];
    // a JvH 1000 is about 68 × 48 cm: 0.33 m² per 1000 pieces; a table tennis table is 2.74 × 1.525 m
    if (kampioen) f.push(`${esc(kampioen)} heeft al <b>${getal(kStukjes)} stukjes</b> gelegd. Daarmee bedek je <b>${getal(Math.round(kStukjes * 0.000326 / 4.18))} tafeltennistafels</b>.`);

    const metDatum = logs.filter((l) => l.datum);
    const perMaand = [...groepeer(metDatum, (l) => l.datum.slice(0, 7))].sort((x, y) => y[1].length - x[1].length)[0];
    if (perMaand) {
      const [j, m] = perMaand[0].split("-");
      f.push(`De drukste puzzelmaand was <b>${MAANDEN[m - 1]} ${j}</b>, met ${perMaand[1].length} puzzels.`);
    }
    const perDag = [...groepeer(metDatum, (l) => l.datum)].sort((x, y) => y[1].length - x[1].length)[0];
    if (perDag && perDag[1].length > 1) f.push(`Op <b>${datum(perDag[0])}</b> legden we ${perDag[1].length} puzzels op één dag.`);

    // longest run of days in a row with at least one puzzle
    const dagen = [...new Set(metDatum.map((l) => l.datum))].sort().map((x) => Date.parse(x) / 864e5);
    let reeks = 1, beste = 1, eind = dagen[0];
    for (let i = 1; i < dagen.length; i++) {
      reeks = Math.round(dagen[i] - dagen[i - 1]) === 1 ? reeks + 1 : 1;
      if (reeks > beste) { beste = reeks; eind = dagen[i]; }
    }
    if (beste > 1) f.push(`De langste reeks: <b>${beste} dagen achter elkaar</b> een puzzel gelegd, tot en met ${datum(new Date(eind * 864e5).toISOString().slice(0, 10))}.`);

    const weekdag = [...groepeer(metDatum, (l) => new Date(l.datum).getUTCDay())].sort((x, y) => y[1].length - x[1].length)[0];
    if (weekdag) f.push(`Onze favoriete puzzeldag is de <b>${DAGEN[weekdag[0]]}</b>: ${weekdag[1].length} van de ${metDatum.length} puzzels.`);

    // the biggest improvement of one team on one version, first time against the last
    let verbetering = null;
    for (const lijst of groepeer(getimed.filter((l) => l.datum), (l) => `${l.versie}#${l.team}`).values()) {
      if (lijst.length < 2) continue;
      lijst.sort((x, y) => x.datum.localeCompare(y.datum));
      const winst = lijst[0].sec - lijst[lijst.length - 1].sec;
      if (!verbetering || winst > verbetering.winst) verbetering = { winst, eerst: lijst[0], laatst: lijst[lijst.length - 1] };
    }
    if (verbetering && verbetering.winst > 0) {
      const { eerst, laatst } = verbetering;
      f.push(`De grootste verbetering: ${esc(wie(eerst.makers))} legden <i>${esc(naam(eerst.a))}</i> (${eerst.stukjes}) eerst in ${tijd(eerst.sec)} en later in ${tijd(laatst.sec)}: <b>${woorden(verbetering.winst)} sneller</b>.`);
    }

    // fastest ever per piece count (sizes with at least 5 timed logs)
    for (const [stukjes, lijst] of groepeer(getimed, (l) => l.stukjes)) {
      if (lijst.length < 5) continue;
      const s = lijst.reduce((x, y) => (y.sec < x.sec ? y : x));
      f.push(`De snelste ${getal(stukjes)} ooit: <b>${tijd(s.sec)}</b> door ${esc(wie(s.makers))}, met <i>${esc(naam(s.a))}</i>.`);
    }
    const langst = getimed.reduce((x, y) => (!x || y.sec > x.sec ? y : x), null);
    if (langst) f.push(`De langste puzzelsessie: <i>${esc(naam(langst.a))}</i> (${getal(langst.stukjes)}) door ${esc(wie(langst.makers))}, in <b>${tijd(langst.sec)}</b>.`);
    const oudste = dozen.map((e) => D.afb[e.afbeelding]).filter((a) => a && a.jaar).sort((x, y) => x.jaar - y.jaar)[0];
    if (oudste) f.push(`De oudste tekening in de kast: <i>${esc(naam(oudste))}</i>, uit <b>${oudste.jaar}</b>.`);

    let i = Math.floor(Math.random() * f.length);
    const toon = () => { $("feitje").innerHTML = f[i % f.length]; };
    $("nog-feitje").addEventListener("click", () => { i += 1; toon(); });
    toon();
  }

  // ---------------------------------------------------------------- per year, per person, collection, most done

  function perJaar() {
    const g = groepeer(D.logs, (l) => (l.datum ? l.datum.slice(0, 4) : "zonder datum"));
    const rijen = [...g].sort((x, y) => x[0].localeCompare(y[0]));
    const max = Math.max(...rijen.map(([, ls]) => ls.length));
    $("per-jaar").innerHTML = rijen.map(([j, ls]) => {
      const st = som(ls.map((l) => l.gelegd));
      return `<div class="balk" title="${esc(j)}: ${ls.length} puzzels, ${getal(st)} stukjes"><span class="balk-label">${esc(j === "zonder datum" ? "Zonder datum" : j)}</span>`
        + `<span class="balk-spoor"><span class="balk-vul" style="width:${(ls.length / max) * 100}%"></span></span>`
        + `<span class="balk-getal"><b>${ls.length}</b> <small>${getal(st)} stukjes</small></span></div>`;
    }).join("");
  }

  const tabel = (kop, rijen, voet = "") =>
    `<thead><tr>${kop.map((k, i) => `<th${i ? ' class="num"' : ""}>${k}</th>`).join("")}</tr></thead>`
    + `<tbody>${rijen.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>`
    + (voet ? `<tfoot><tr>${voet.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr></tfoot>` : "");

  function perPersoon() {
    const p = {};
    for (const l of D.logs) for (const m of l.makers) {
      const x = (p[m] ||= { n: 0, stukjes: 0, sec: 0, solo: 0 });
      x.n += 1;
      x.stukjes += l.gelegd;
      x.sec += l.sec || 0;
      if (l.makers.length === 1) x.solo += 1;
    }
    const rijen = Object.entries(p).sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0], "nl"))
      .map(([m, x]) => [esc(m), getal(x.n), getal(x.solo), getal(x.stukjes), `${getal(Math.round(x.sec / 3600))} u`]);
    $("per-persoon").innerHTML = tabel(["Naam", "Puzzels", "Solo", "Stukjes", "Puzzeltijd"], rijen);
  }

  function collectie() {
    const o = {};
    for (const e of D.dozen) for (const n of e.eigenaren) {
      const x = (o[n] ||= { n: 0, stukjes: 0 });
      x.n += 1;
      x.stukjes += e.stukjes || 0;
    }
    $("per-eigenaar").innerHTML = tabel(["Eigenaar", "Dozen", "Stukjes"],
      Object.entries(o).sort((x, y) => y[1].n - x[1].n).map(([n, x]) => [esc(n), getal(x.n), getal(x.stukjes)]),
      ["Samen", getal(D.dozen.length), getal(som(D.dozen.map((e) => e.stukjes || 0)))]);

    const maten = [...new Set(D.dozen.map((e) => e.stukjes).concat(D.logs.map((l) => l.stukjes)).filter(Boolean))].sort((x, y) => x - y);
    $("per-stukjes").innerHTML = tabel(["Stukjes", "Dozen", "Gelegd", "Snelste"], maten.map((s) => {
      const t = D.getimed.filter((l) => l.stukjes === s);
      const snel = t.length ? t.reduce((x, y) => (y.sec < x.sec ? y : x)) : null;
      return [getal(s), getal(D.dozen.filter((e) => e.stukjes === s).length), getal(D.logs.filter((l) => l.stukjes === s).length),
        snel ? `<span title="${esc(wie(snel.makers))}, ${esc(naam(snel.a))}">${tijd(snel.sec)}</span>` : "–"];
    }));
  }

  function meest() {
    const versies = [...groepeer(D.logs.filter((l) => l.a), (l) => l.versie)].sort((x, y) => y[1].length - x[1].length).slice(0, 10);
    $("meest").innerHTML = versies.map(([, ls]) =>
      `<li><span><b>${esc(naam(ls[0].a))}</b> <span class="muted">${getal(ls[0].stukjes)} stukjes</span></span><span class="num">${ls.length}×</span></li>`).join("");
    const gefilmd = D.logs.filter((l) => l.gefilmd || l.video);
    const met = gefilmd.filter((l) => l.video).length;
    $("videos").textContent = `${gefilmd.length} keer gefilmd: ${met} met een video op YouTube, ${gefilmd.length - met} wachten nog op een link.`;
  }

  // ---------------------------------------------------------------- comparing a person or team

  function teams() {
    const g = [...groepeer(D.getimed, (l) => l.team)].filter(([, ls]) => ls.length >= MIN_TEAM)
      .sort((x, y) => y[1].length - x[1].length);
    const sel = $("team");
    sel.innerHTML = g.map(([k, ls]) => `<option value="${esc(k)}">${esc(wie(ls[0].makers))}${ls[0].makers.length === 1 ? " (solo)" : ""} · ${ls.length}×</option>`).join("");
    let bewaard = "";
    try { bewaard = localStorage.getItem(TEAM_KEY) || ""; } catch (e) { /* private window */ }
    if (g.some(([k]) => k === bewaard)) sel.value = bewaard;
    sel.addEventListener("change", () => {
      try { localStorage.setItem(TEAM_KEY, sel.value); } catch (e) { /* ignore */ }
      vergelijk(sel.value);
    });
    if (g.length) vergelijk(sel.value);
  }

  function vergelijk(team) {
    const eigen = D.getimed.filter((l) => l.team === team);
    const makers = eigen[0].makers;
    progressie(eigen.filter((l) => l.stukjes === 1000 && l.datum), makers);
    tegen(eigen, makers);
  }

  // time against date on 1000 pieces, with the average of the last 5 as a trend line
  function progressie(ls, makers) {
    ls = [...ls].sort((x, y) => x.datum.localeCompare(y.datum));
    if (ls.length < MIN_TREND) {
      $("progressie").innerHTML = `<h3>Op 1000 stukjes</h3><p class="muted">${esc(wie(makers))} ${makers.length === 1 ? "heeft" : "hebben"} ${ls.length ? `pas ${ls.length} keer` : "nog geen"} 1000 stukjes met tijd en datum gelegd. Voor een trend zijn er minstens ${MIN_TREND} nodig.</p>`;
      return;
    }
    const k = Math.min(5, Math.floor(ls.length / 2));
    const gem = (xs) => som(xs.map((l) => l.sec)) / xs.length;
    const voor = gem(ls.slice(0, k)), na = gem(ls.slice(-k));
    const jaar = ls[0].datum.slice(0, 4);
    const conclusie = Math.abs(voor - na) < 60
      ? `${esc(wie(makers))} ${zijn(makers)} sinds ${jaar} ongeveer even snel gebleven.`
      : `${esc(wie(makers))} ${zijn(makers)} sinds ${jaar} gemiddeld <b>${woorden(voor - na)} ${na < voor ? "sneller" : "langzamer"}</b> geworden.`;
    $("progressie").innerHTML = `<h3>Op 1000 stukjes</h3><p>${conclusie} <span class="muted">De eerste ${k} keer gemiddeld ${tijd(Math.round(voor))}, de laatste ${k} keer ${tijd(Math.round(na))}.</span></p>`
      + grafiek(ls) + `<p class="legenda muted"><span class="stip"></span> één keer gelegd <span class="lijntje"></span> gemiddelde van de laatste 5 keer</p>`;
  }

  function grafiek(ls) {
    const B = 640, H = 240, L = 48, R = 12, T = 12, O = 28;
    const xs = ls.map((l) => Date.parse(l.datum));
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 - x0 < 864e5 * 30) { x0 -= 864e5 * 15; x1 += 864e5 * 15; }
    const secs = ls.map((l) => l.sec);
    const stap = [300, 600, 900, 1800, 3600, 7200].find((s) => (Math.max(...secs) - Math.min(...secs)) / s <= 5) || 7200;
    const y0 = Math.floor(Math.min(...secs) / stap) * stap, y1 = Math.ceil(Math.max(...secs) / stap) * stap || stap;
    const px = (t) => L + ((t - x0) / (x1 - x0)) * (B - L - R);
    const py = (s) => T + (1 - (s - y0) / (y1 - y0 || 1)) * (H - T - O);
    let svg = "";
    for (let s = y0; s <= y1; s += stap) {
      svg += `<line class="raster" x1="${L}" x2="${B - R}" y1="${py(s)}" y2="${py(s)}"/><text class="as" x="${L - 6}" y="${py(s) + 4}" text-anchor="end">${tijd(s).slice(0, -3)}</text>`;
    }
    // ticks on month starts, at most about 6
    const start = new Date(x0), maanden = (new Date(x1).getUTCFullYear() - start.getUTCFullYear()) * 12 + new Date(x1).getUTCMonth() - start.getUTCMonth();
    const elke = [1, 2, 3, 6, 12, 24].find((m) => maanden / m <= 6) || 24;
    for (let m = 1; m <= maanden + 1; m++) {
      const d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1);
      const dt = new Date(d);
      if (d > x1 || (dt.getUTCFullYear() * 12 + dt.getUTCMonth()) % elke) continue;
      const label = elke >= 12 ? dt.getUTCFullYear() : `${MAANDEN[dt.getUTCMonth()].slice(0, 3)} '${String(dt.getUTCFullYear()).slice(2)}`;
      svg += `<text class="as" x="${px(d)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    }
    const trend = ls.map((l, i) => {
      const w = ls.slice(Math.max(0, i - 4), i + 1);
      return `${px(xs[i]).toFixed(1)},${py(som(w.map((x) => x.sec)) / w.length).toFixed(1)}`;
    });
    svg += `<polyline class="trend" points="${trend.join(" ")}"/>`;
    svg += ls.map((l, i) => `<circle class="punt" cx="${px(xs[i]).toFixed(1)}" cy="${py(l.sec).toFixed(1)}" r="5"><title>${tijd(l.sec)} · ${esc(naam(l.a))} · ${datum(l.datum)}</title></circle>`).join("");
    return `<svg class="grafiek" viewBox="0 0 ${B} ${H}" role="img" aria-label="Tijden op 1000 stukjes door de tijd">${svg}</svg>`;
  }

  // against every other team of the same size, on the versions both did: best time against best time
  function tegen(eigen, makers) {
    const best = (ls) => {
      const b = {};
      for (const l of ls) if (!b[l.versie] || l.sec < b[l.versie].sec) b[l.versie] = l;
      return b;
    };
    const mijn = best(eigen);
    const anderen = groepeer(D.getimed.filter((l) => l.makers.length === makers.length && l.team !== eigen[0].team), (l) => l.team);
    const rijen = [];
    for (const ls of anderen.values()) {
      const hun = best(ls);
      const samen = Object.keys(mijn).filter((v) => hun[v]).map((v) => ({ mijn: mijn[v], hun: hun[v] }));
      if (!samen.length) continue;
      // geometric mean of the time ratios, so one long puzzle does not weigh more than a short one
      const r = Math.exp(som(samen.map((x) => Math.log(x.mijn.sec / x.hun.sec))) / samen.length);
      rijen.push({ makers: ls[0].makers, samen, r });
    }
    rijen.sort((x, y) => y.samen.length - x.samen.length || x.r - y.r);
    const soort = { 1: "andere puzzelaars solo", 2: "andere duo's", 3: "andere groepjes van drie", 4: "andere teams van vier" }[makers.length] || `andere groepen van ${makers.length}`;
    if (!rijen.length) {
      $("tegen").innerHTML = `<h3>Tegen ${soort}</h3><p class="muted">Nog geen puzzels die ${esc(wie(makers))} en ${soort} allebei met tijd gelegd hebben.</p>`;
      return;
    }
    $("tegen").innerHTML = `<h3>Tegen ${soort}</h3><ul class="tegen">` + rijen.map(({ makers: m, samen, r }) => {
      const pct = Math.round(Math.abs(1 - r) * 100);
      const oordeel = pct < 1 ? "ongeveer even snel" : `gemiddeld <b>${pct}% ${r < 1 ? "sneller" : "langzamer"}</b>`;
      return `<li><details><summary>Tegen <b>${esc(wie(m))}</b>: ${oordeel} <span class="muted">(${samen.length} ${samen.length === 1 ? "puzzel" : "puzzels"})</span></summary><ul class="duel">`
        + samen.sort((x, y) => (x.mijn.sec - x.hun.sec) - (y.mijn.sec - y.hun.sec)).map(({ mijn: a, hun: b }) => {
          const v = a.sec - b.sec;
          return `<li><span>${esc(naam(a.a))} <span class="muted">${getal(a.stukjes)}</span></span><span class="num">${tijd(a.sec)} – ${tijd(b.sec)}</span>`
            + `<span class="num ${v < 0 ? "plus" : v > 0 ? "min" : ""}">${v ? `${v < 0 ? "−" : "+"}${tijd(Math.abs(v))}` : "gelijk"}</span></li>`;
        }).join("") + "</ul></details></li>";
    }).join("") + "</ul>";
  }

  // ---------------------------------------------------------------- versions done often

  function vaak() {
    const g = [...groepeer(D.getimed.filter((l) => l.a), (l) => l.versie)].filter(([, ls]) => ls.length >= VAAK_MIN)
      .sort((x, y) => y[1].length - x[1].length || naam(x[1][0].a).localeCompare(naam(y[1][0].a), "nl"));
    let alle = false;
    const teken = () => {
      $("vaak").innerHTML = (alle ? g : g.slice(0, VAAK_TOON)).map(([, ls]) => {
        const snel = [...ls].sort((x, y) => x.sec - y.sec);
        const opDatum = ls.filter((l) => l.datum).sort((x, y) => x.datum.localeCompare(y.datum));
        const [eerst, laatst] = [opDatum[0], opDatum[opDatum.length - 1]];
        let zin = `Tussen de snelste en de langzaamste zit ${woorden(snel[snel.length - 1].sec - snel[0].sec)}.`;
        if (eerst && laatst && eerst !== laatst) {
          const v = eerst.sec - laatst.sec;
          zin += ` De eerste keer ${tijd(eerst.sec)} (${esc(wie(eerst.makers))}), de laatste keer ${tijd(laatst.sec)} (${esc(wie(laatst.makers))}): `
            + (Math.abs(v) < 60 ? "ongeveer even snel." : `${woorden(v)} ${v > 0 ? "sneller" : "langzamer"}.`);
        }
        return `<li><details><summary><b>${esc(naam(ls[0].a))}</b> <span class="muted">${getal(ls[0].stukjes)} stukjes · ${ls.length}× · snelste ${tijd(snel[0].sec)} (${esc(wie(snel[0].makers))})</span></summary>`
          + `<ul class="duel">${snel.map((l) => `<li><span class="num">${tijd(l.sec)}</span><span>${esc(wie(l.makers))}</span><span class="muted num">${datum(l.datum)}</span></li>`).join("")}</ul>`
          + `<p class="muted klein">${zin}</p></details></li>`;
      }).join("");
      $("vaak-meer").hidden = g.length <= VAAK_TOON;
      $("vaak-meer").textContent = alle ? "Minder tonen" : `Toon alle ${g.length}`;
    };
    $("vaak-meer").addEventListener("click", () => { alle = !alle; teken(); });
    teken();
  }

  // ---------------------------------------------------------------- the NK

  function nk() {
    const gedaan = [], nog = [];
    for (const n of D.nk) {
      const grootte = NK_GROOTTE[n.categorie];
      const ons = D.getimed.filter((l) => l.e.afbeelding === n.afbeelding && l.stukjes === n.stukjes && l.makers.length === grootte);
      if (ons.length) gedaan.push({ n, best: ons.reduce((x, y) => (y.sec < x.sec ? y : x)) });
      else nog.push(n);
    }
    gedaan.sort((x, y) => (x.best.sec - x.n.sec) - (y.best.sec - y.n.sec));
    const sneller = gedaan.filter((x) => x.best.sec < x.n.sec).length;
    $("nk-kop").innerHTML = gedaan.length
      ? `We legden <b>${gedaan.length}</b> NK-puzzels zoals op het NK, en waren <b>${sneller}</b> keer sneller dan de winnaar.`
      : "We hebben nog geen NK-puzzel gelegd zoals op het NK.";
    $("nk").innerHTML = gedaan.length ? tabel(["Puzzel", "Winnaar", "Wij", "Verschil"], gedaan.map(({ n, best }) => {
      const v = best.sec - n.sec;
      return [`${esc(D.afb[n.afbeelding] ? naam(D.afb[n.afbeelding]) : n.puzzel)}<small class="muted">NK ${n.jaar}, ${esc(n.ronde)}, ${esc(n.categorie)}</small>`,
        tijd(n.sec), `${tijd(best.sec)}<small class="muted">${esc(wie(best.makers))}</small>`,
        `<span class="${v < 0 ? "plus" : "min"}">${v < 0 ? "−" : "+"}${tijd(Math.abs(v))}</span>`];
    })) : "";
    const inKast = (n) => D.dozen.some((e) => e.afbeelding === n.afbeelding && e.stukjes === n.stukjes);
    nog.sort((x, y) => inKast(y) - inKast(x) || x.jaar - y.jaar);
    $("nk-nog-kop").textContent = `NK-puzzels die we nog niet zo gelegd hebben (${nog.length})`;
    $("nk-nog").innerHTML = nog.map((n) => `<li>${esc(D.afb[n.afbeelding] ? naam(D.afb[n.afbeelding]) : n.puzzel)} <span class="muted">NK ${n.jaar}, ${esc(n.ronde)}, ${esc(n.categorie)}, winnaar ${tijd(n.sec)}${inKast(n) ? " · staat in de kast" : ""}</span></li>`).join("");
  }

  // ---------------------------------------------------------------- start

  data().then((d) => {
    D = voorbereiden(d);
    tegels();
    feitjes();
    perJaar();
    perPersoon();
    collectie();
    meest();
    teams();
    vaak();
    nk();
    const t = new Date(d.updated);
    $("updated").textContent =
      `Bijgewerkt uit de Sheet op ${t.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })} om ${t.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
  }).catch((e) => {
    console.error(e);
    $("tiles").innerHTML = '<li class="empty">De gegevens konden niet worden geladen. Probeer het over een paar minuten opnieuw.</li>';
  });
})();
