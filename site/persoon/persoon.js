/* Puzzullu — one person's page (/persoon/?naam=Hanna): totals, the week streak, badges, the records they hold, their
   fastest times, who they puzzle with, and when. the year overview, and a heatmap. Computed from data.json. */
(function () {
  "use strict";

  const { esc, getal, tijd, datum, data } = window.PZ;
  const R = window.PZR;
  const $ = (id) => document.getElementById(id);
  const PARTNERS = 8; // partners shown before "Toon alle"

  const wie = new URLSearchParams(location.search).get("naam") || "";
  const som = (xs) => xs.reduce((n, x) => n + x, 0);

  function nietGevonden(tekst) {
    $("naam").textContent = "Niet gevonden";
    $("niet-gevonden").hidden = false;
    $("niet-gevonden").innerHTML = `${esc(tekst)} <a href="/statistieken/#mensen">Bekijk alle mensen</a>.`;
  }

  function tegels(eigen, D) {
    const sec = som(eigen.map((l) => l.sec || 0));
    const solo = eigen.filter((l) => l.makers.length === 1).length;
    const dozen = D.dozen.filter((e) => e.eigenaren.includes(wie)).length;
    $("tiles").innerHTML = [[eigen.length, "puzzels gelegd"], [som(eigen.map((l) => l.gelegd)), "stukjes gelegd"],
      [Math.round(sec / 3600), "uur gepuzzeld"], [solo, "keer solo"], [dozen, dozen === 1 ? "doos in de kast" : "dozen in de kast"]]
      .map(([n, label]) => `<li class="tile"><b>${esc(getal(n))}</b><span>${esc(label)}</span></li>`).join("");
    const eerste = eigen.filter((l) => l.datum).sort((x, y) => x.datum.localeCompare(y.datum))[0];
    $("sinds").innerHTML = eerste ? `Puzzelt mee sinds ${datum(eerste.datum)}, met <i>${esc(R.naam(eerste.a))}</i>.` : "";
  }

  function reeks(eigen) {
    const w = R.weekreeks(eigen);
    const vuur = w.huidig ? "🔥".repeat(Math.min(w.huidig, 3)) : "";
    const deze = w.gehaald ? `Deze week al ${getal(w.dezeWeek)} stukjes: deze week telt mee.`
      : w.dezeWeek ? `Deze week ${getal(w.dezeWeek)} stukjes. Nog ${getal(w.nodig)} voor ${w.huidig ? "je reeks" : "een nieuwe reeks"}.`
        : `Deze week nog niets gelegd. ${getal(R.WEEK_STUKJES)} stukjes voor ${w.huidig ? "je reeks" : "een nieuwe reeks"}.`;
    $("reeks").innerHTML = `<p class="feitje-kop">Weekreeks</p>`
      + `<p class="reeks-getal"><b>${w.huidig}</b> ${w.huidig === 1 ? "week" : "weken"} op rij ${vuur}</p>`
      + `<p class="muted">${deze} Een week telt als je er minstens ${getal(R.WEEK_STUKJES)} stukjes legt.`
      + (w.langste ? ` Langste reeks: ${w.langste} ${w.langste === 1 ? "week" : "weken"}${w.langsteTot ? `, tot de week van ${datum(w.langsteTot)}` : ""}.` : "") + "</p>";
  }

  // the records this person holds now: one line on top, then per size and group the time (no trophy on every row)
  function records(D) {
    const alle = R.records(D), mijn = alle.filter((r) => r.log.makers.includes(wie));
    const naamGroep = Object.fromEntries(R.GROEPEN);
    $("p-records").innerHTML = mijn.length
      ? `<p class="muted">${esc(wie)} houdt <b>${mijn.length}</b> van de ${alle.length} records op de <a href="/statistieken/#records">records-muur</a>.</p>`
        + `<ul class="rec-lijst">${mijn.map((r) => { const l = r.log; return `<li><span class="rec-groep">${esc(R.maatNaam(r))}<br>${naamGroep[r.groep]}</span>`
        + `<span class="rec-tijd">${tijd(l.sec)}</span><span class="rec-wie">${R.mensen(l.makers)}`
        + `<small class="muted">${esc(R.naam(l.a))}${l.datum ? ` · <span class="nw">sinds ${datum(l.datum)}</span>` : ""}</small></span></li>`; }).join("")}</ul>`
      : '<p class="muted">Nog geen record. Kijk op de <a href="/statistieken/#records">records-muur</a> welke tijden er te verbeteren zijn.</p>';
  }

  function snelst(eigen) {
    const maten = [...new Map(eigen.filter((l) => l.sec != null && l.stukjes).map((l) => [l.maat, l])).values()].sort(R.opMaat);
    const beste = (ls) => ls.reduce((x, y) => (!x || y.sec < x.sec ? y : x), null);
    const cel = (l, metWie) => (l ? `${tijd(l.sec)}<small class="muted">${esc(R.naam(l.a))}${metWie ? ` · ${esc(l.makers.filter((m) => m !== wie).join(", "))}` : ""}</small>` : "–");
    $("p-snelst").innerHTML = maten.length ? `<thead><tr><th>Stukjes</th><th>Solo</th><th>Samen</th></tr></thead><tbody>`
      + maten.map((m) => {
        const ls = eigen.filter((l) => l.maat === m.maat && l.sec != null);
        return `<tr><td>${esc(R.maatNaam(m))}</td><td>${cel(beste(ls.filter((l) => l.makers.length === 1)))}</td><td>${cel(beste(ls.filter((l) => l.makers.length > 1)), true)}</td></tr>`;
      }).join("") + "</tbody>" : '<tbody><tr><td class="muted">Nog geen tijden.</td></tr></tbody>';
  }

  function partners(eigen) {
    const p = new Map();
    for (const l of eigen) for (const m of l.makers) {
      if (m === wie) continue;
      const x = p.get(m) || { n: 0, laatst: "" };
      x.n += 1;
      if ((l.datum || "") > x.laatst) x.laatst = l.datum;
      p.set(m, x);
    }
    const rijen = [...p].sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0], "nl"));
    let alle = false;
    const teken = () => {
      $("p-partners").innerHTML = rijen.length ? `<thead><tr><th>Met</th><th class="num">Samen</th><th class="num">Laatst</th></tr></thead><tbody>`
        + (alle ? rijen : rijen.slice(0, PARTNERS)).map(([m, x]) => `<tr><td>${R.mens(m)}</td><td class="num">${x.n}×</td><td class="num">${x.laatst ? datum(x.laatst) : "–"}</td></tr>`).join("")
        + "</tbody>" : '<tbody><tr><td class="muted">Altijd solo.</td></tr></tbody>';
      $("partners-meer").hidden = rijen.length <= PARTNERS;
      $("partners-meer").textContent = alle ? "Minder tonen" : `Toon alle ${rijen.length} partners`;
    };
    $("partners-meer").addEventListener("click", () => { alle = !alle; teken(); });
    teken();
  }

  // ---------------------------------------------------------------- year overview
  // one year at a time (chips: the last 4 years, older ones behind "Meer"), the newest year first

  const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const JAREN = 4;

  function jaaroverzicht(eigen, D, badgeLijst) {
    const opVolgorde = window.PZB.opVolgorde(eigen);
    const jaren = [...new Set(eigen.filter((l) => l.datum).map((l) => l.datum.slice(0, 4)))].sort().reverse();
    if (!jaren.length) { $("jaar").hidden = true; return; }
    let jaar = jaren[0], oud = false;

    const feit = (kop, tekst) => (tekst ? `<li><span class="feitje-kop">${esc(kop)}</span><span>${tekst}</span></li>` : "");
    const teken = () => {
      const toon = oud ? jaren : jaren.slice(0, JAREN);
      $("j-jaren").innerHTML = `<div class="chips jaren${oud ? " open" : ""}" role="group" aria-label="Jaar">`
        + toon.map((j) => `<button type="button" class="chip" data-jaar="${j}" aria-pressed="${j === jaar}">${j}</button>`).join("")
        + (jaren.length > JAREN ? `<button type="button" class="chip meer" data-meer aria-expanded="${oud}">${oud ? "Minder ▴" : "Meer ▾"}</button>` : "") + "</div>";

      const ls = opVolgorde.filter((l) => l.datum && l.datum.startsWith(jaar));
      const vorig = eigen.filter((l) => l.datum && l.datum.startsWith(String(jaar - 1))).length;
      const sec = som(ls.map((l) => l.sec || 0));
      $("j-tiles").innerHTML = [[ls.length, ls.length === 1 ? "puzzel" : "puzzels"], [som(ls.map((l) => l.gelegd)), "stukjes"],
        [Math.round(sec / 3600), "uur"], [ls.filter((l) => l.makers.length === 1).length, "solo"]]
        .map(([n, label]) => `<li class="tile"><b>${esc(getal(n))}</b><span>${esc(label)}</span></li>`).join("");

      // the busiest month
      const perMaand = new Array(12).fill(0);
      for (const l of ls) perMaand[+l.datum.slice(5, 7) - 1] += 1;
      const top = Math.max(...perMaand), maand = perMaand.indexOf(top);
      // the fastest: most pieces per minute, puzzles of 500 pieces or more with a time
      const snel = ls.filter((l) => l.sec && l.stukjes >= 500).sort((x, y) => y.stukjes / y.sec - x.stukjes / x.sec)[0];
      // the favourite partner
      const p = new Map();
      for (const l of ls) for (const m of l.makers) if (m !== wie) p.set(m, (p.get(m) || 0) + 1);
      const partner = [...p].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "nl"))[0];
      // the biggest improvement: a time this year against the best earlier time on the same version with the same group
      let beter = null;
      const beste = new Map();
      for (const l of opVolgorde) {
        if (l.sec == null || !l.stukjes) continue;
        const k = `${l.versie}#${l.team}`, b = beste.get(k);
        if (b != null && l.datum && l.datum.startsWith(jaar) && l.sec < b && (!beter || b - l.sec > beter.winst)) beter = { l, winst: b - l.sec, oud: b };
        if (b == null || l.sec < b) beste.set(k, l.sec);
      }
      // the longest run of days, and of weeks with enough pieces, within this year
      const dagen = [...new Set(ls.map((l) => R.dagNr(l.datum)))].sort((x, y) => x - y);
      let run = 0, dagreeks = 0;
      dagen.forEach((d, i) => { run = i && d === dagen[i - 1] + 1 ? run + 1 : 1; dagreeks = Math.max(dagreeks, run); });
      const weekreeks = R.weekreeks(ls).langste;

      const met = (l) => (l.makers.length > 1 ? `, met ${R.mensen(l.makers.filter((m) => m !== wie))}` : ", solo");
      $("j-feiten").innerHTML = [
        vorig ? feit("Tegen het jaar ervoor", `${ls.length >= vorig ? `${getal(ls.length - vorig)} meer` : `${getal(vorig - ls.length)} minder`} dan in ${jaar - 1} (${getal(vorig)})`) : "",
        top ? feit("Drukste maand", `${MAANDEN[maand]}, met ${top} ${top === 1 ? "puzzel" : "puzzels"}`) : "",
        snel ? feit("Snelste puzzel", `<i>${esc(R.naam(snel.a))}</i>, ${getal(snel.stukjes)} stukjes in ${tijd(snel.sec)}${met(snel)} (${(snel.stukjes / (snel.sec / 60)).toFixed(1).replace(".", ",")} stukjes per minuut)`) : "",
        partner ? feit("Favoriete puzzelpartner", `${R.mens(partner[0])}, ${partner[1]} ${partner[1] === 1 ? "puzzel" : "puzzels"} samen`) : "",
        beter ? feit("Grootste verbetering", `<i>${esc(R.naam(beter.l.a))}</i> (${getal(beter.l.stukjes)})${met(beter.l)}: ${tijd(beter.l.sec)}, ${esc(verschil(beter.winst))} sneller dan de beste tijd ervoor (${tijd(beter.oud)})`) : "",
        dagreeks > 1 ? feit("Langste dagreeks", `${dagreeks} dagen op rij gepuzzeld`) : "",
        weekreeks ? feit("Langste weekreeks", `${weekreeks} ${weekreeks === 1 ? "week" : "weken"} op rij minstens ${getal(R.WEEK_STUKJES)} stukjes`) : "",
      ].join("");

      // the badges (and ranks) reached this year
      const B = window.PZB;
      const nieuw = [];
      for (const x of badgeLijst) x.behaald.forEach((l, i) => { if (l && l.datum && l.datum.startsWith(jaar)) nieuw.push({ b: x.b, rang: i + 1, l }); });
      nieuw.sort((x, y) => x.l.datum.localeCompare(y.l.datum) || x.l.id.localeCompare(y.l.id));
      $("j-badges").innerHTML = nieuw.length ? `<p class="feitje-kop jaar-badges-kop">${nieuw.length} nieuwe ${nieuw.length === 1 ? "badge" : "badges en rangen"} in ${jaar}</p>`
        + `<ul class="jaar-badges">${nieuw.map(({ b, rang, l }) => `<li title="${esc(b.naam)} (${esc(B.rangNaam(b, rang))}), ${datum(l.datum)}">${B.svg(b, rang, 44)}<span>${esc(b.naam)}<small class="muted">${esc(b.grenzen.length > 1 ? B.RANGEN[rang - 1] : B.rangNaam(b, rang))} · ${datum(l.datum)}</small></span></li>`).join("")}</ul>`
        : `<p class="muted">Geen nieuwe badges in ${jaar}.</p>`;
    };

    $("j-jaren").addEventListener("click", (ev) => {
      if (ev.target.closest("[data-meer]")) { oud = !oud; return teken(); }
      const c = ev.target.closest("[data-jaar]");
      if (c) { jaar = c.dataset.jaar; teken(); }
    });
    teken();
  }

  function verschil(sec) {
    const u = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    if (u) return `${u} uur${m ? ` en ${m} ${m === 1 ? "minuut" : "minuten"}` : ""}`;
    if (m) return `${m} ${m === 1 ? "minuut" : "minuten"}${m < 5 && s ? ` en ${s} seconden` : ""}`;
    return `${s} seconden`;
  }

  // ---------------------------------------------------------------- badges

  function badges(D, alle) {
    const B = window.PZB;
    const opRang = (x, y) => y.rang - x.rang || B.ALLE.indexOf(x.b) - B.ALLE.indexOf(y.b);
    const rang = alle.filter((x) => !x.b.feest).sort((x, y) => (y.rang > 0) - (x.rang > 0) || opRang(x, y));
    const feest = alle.filter((x) => x.b.feest).sort((x, y) => (y.rang > 0) - (x.rang > 0) || B.ALLE.indexOf(x.b) - B.ALLE.indexOf(y.b));
    const tegel = (x) => {
      const max = x.rang >= x.b.grenzen.length;
      const balk = x.b.grenzen.length > 1 && !max ? `<span class="badge-balk"><i style="width:${Math.round(B.voortgang(x) * 100)}%"></i></span>` : "";
      return `<li><button type="button" class="badge${x.rang ? "" : " nog"}" data-id="${x.b.id}">${B.svg(x.b, x.rang)}`
        + `<span class="badge-naam">${esc(x.b.naam)}</span><span class="badge-rang">${esc(B.rangNaam(x.b, x.rang))}</span>${balk}</button></li>`;
    };
    const behaald = alle.filter((x) => x.rang).length;
    $("badges-kop").textContent = `${behaald} van de ${alle.length} badges behaald. Tik op een badge voor de uitleg.`;
    $("b-rang").innerHTML = rang.map(tegel).join("");
    let open = false;
    const feestTeken = () => {
      const gehaald = feest.filter((x) => x.rang);
      $("b-feest").innerHTML = (open ? feest : gehaald).map(tegel).join("") || '<li class="muted badges-leeg">Nog geen feestdagbadge.</li>';
      $("feest-meer").hidden = gehaald.length === feest.length;
      $("feest-meer").textContent = open ? "Alleen behaalde tonen" : `Toon alle ${feest.length} feestdagbadges`;
    };
    $("feest-meer").addEventListener("click", () => { open = !open; feestTeken(); });
    feestTeken();

    // the card: explanation, the thresholds, and when each rank was reached
    const kaart = (x) => {
      const { b, rang, waarde, behaald: logs } = x;
      const wanneer = (l) => (l ? `${l.datum ? datum(l.datum) : "datum onbekend"} · ${esc(R.naam(l.a))}` : "nu");
      const rijen = b.grenzen.map((g, i) => {
        const l = logs[i], gehaald = i < rang;
        const label = b.grenzen.length > 1 ? B.RANGEN[i] : B.rangNaam(b, 1);
        return `<li class="${gehaald ? "ja" : ""}"><span class="bk-rang">${esc(label)}</span><span class="bk-grens">${esc(B.grensTekst(b, g))}</span>`
          + `<span class="bk-wanneer muted">${gehaald ? wanneer(l) : "nog niet"}</span></li>`;
      }).join("");
      const volgende = b.geenStand ? "" : rang < b.grenzen.length
        ? `<p>Nu: <b>${esc(B.waardeTekst(b, waarde))}</b>${b.minder && waarde !== Infinity ? " (beste tijd)" : ""}. Volgende: ${esc(b.grenzen.length > 1 ? B.RANGEN[rang] : b.naam)}, ${esc(B.grensTekst(b, b.grenzen[rang]))}.</p>`
          + (b.grenzen.length > 1 ? `<span class="badge-balk groot"><i style="width:${Math.round(B.voortgang(x) * 100)}%"></i></span>` : "")
        : `<p>Nu: <b>${esc(B.waardeTekst(b, waarde))}</b>${b.minder ? " (beste tijd)" : ""}. ${b.grenzen.length > 1 ? "Hoogste rang gehaald!" : ""}</p>`;
      $("bk-inhoud").innerHTML = `<div class="bk-kop">${B.svg(b, rang, 104)}<div><h2 id="bk-naam">${esc(b.naam)}</h2><p class="muted">${esc(B.rangNaam(b, rang))}</p></div></div>`
        + `<p>${B.uitleg(b, D)}</p>${volgende}<ul class="bk-lijst">${rijen}</ul>`;
      $("badge-kaart").showModal();
    };
    $("badges").addEventListener("click", (ev) => {
      const k = ev.target.closest(".badge[data-id]");
      if (k) kaart(alle.find((x) => x.b.id === k.dataset.id));
    });
    // tap outside the card closes it
    $("badge-kaart").addEventListener("click", (ev) => { if (ev.target === $("badge-kaart")) $("badge-kaart").close(); });
  }

  data().then((d) => {
    const D = R.voorbereiden(d);
    const eigen = D.logs.filter((l) => l.makers.includes(wie));
    if (!wie) return nietGevonden("Er is geen naam gekozen.");
    if (!eigen.length) return nietGevonden(`Van ${wie} is geen puzzel gevonden.`);
    document.title = `${wie} · Puzzullu`;
    $("naam").textContent = wie;
    $("kal-kop").textContent = `Wanneer puzzelt ${wie}?`;
    $("pagina").hidden = false;
    tegels(eigen, D);
    reeks(eigen);
    const lijst = window.PZB.van(D, wie);
    jaaroverzicht(eigen, D, lijst);
    badges(D, lijst);
    records(D);
    snelst(eigen);
    partners(eigen);
    R.kalender($("p-kalender"), eigen);
    if (location.hash === "#badges") $("badges").scrollIntoView();
  }).catch((e) => {
    console.error(e);
    nietGevonden("De gegevens konden niet worden geladen. Probeer het over een paar minuten opnieuw.");
  });
})();
