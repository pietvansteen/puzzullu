/* Puzzullu — one person's page (/persoon/?naam=Hanna): totals, the week streak, badges, the records they hold, their
   fastest times, who they puzzle with, and when. The year overview comes on top of this. Computed from data.json. */
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

  function records(D) {
    const mijn = R.records(D).filter((r) => r.log.makers.includes(wie));
    const naamGroep = Object.fromEntries(R.GROEPEN);
    $("p-records").innerHTML = mijn.length
      ? `<ul class="rec-lijst">${mijn.map(({ stukjes, groep, log: l }) => `<li><span class="rec-groep">${getal(stukjes)}<br>${naamGroep[groep]}</span>`
        + `<span class="rec-tijd">🏆 ${tijd(l.sec)}</span><span class="rec-wie">${R.mensen(l.makers)}`
        + `<small class="muted">${esc(R.naam(l.a))}${l.datum ? ` · <span class="nw">sinds ${datum(l.datum)}</span>` : ""}</small></span></li>`).join("")}</ul>`
      : '<p class="muted">Nog geen record. Kijk op de <a href="/statistieken/#records">records-muur</a> welke tijden er te verbeteren zijn.</p>';
  }

  function snelst(eigen) {
    const maten = [...new Set(eigen.filter((l) => l.sec != null && l.stukjes).map((l) => l.stukjes))].sort((x, y) => x - y);
    const beste = (ls) => ls.reduce((x, y) => (!x || y.sec < x.sec ? y : x), null);
    const cel = (l, metWie) => (l ? `${tijd(l.sec)}<small class="muted">${esc(R.naam(l.a))}${metWie ? ` · ${esc(l.makers.filter((m) => m !== wie).join(", "))}` : ""}</small>` : "–");
    $("p-snelst").innerHTML = maten.length ? `<thead><tr><th>Stukjes</th><th>Solo</th><th>Samen</th></tr></thead><tbody>`
      + maten.map((s) => {
        const ls = eigen.filter((l) => l.stukjes === s && l.sec != null);
        return `<tr><td class="num">${getal(s)}</td><td>${cel(beste(ls.filter((l) => l.makers.length === 1)))}</td><td>${cel(beste(ls.filter((l) => l.makers.length > 1)), true)}</td></tr>`;
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

  // ---------------------------------------------------------------- badges

  function badges(D) {
    const B = window.PZB;
    const alle = B.van(D, wie);
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
      const volgende = rang < b.grenzen.length
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
    badges(D);
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
