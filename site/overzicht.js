/* Puzzullu — overview page: totals, then every picture once in three levels (picture > versions > times),
   with search, filters and sorting. Settings are remembered per device (localStorage). */
(function () {
  "use strict";

  const { esc, getal, tijd, datum, sterren, data } = window.PZ;
  const $ = (id) => document.getElementById(id);
  const lijst = $("lijst");

  // steps of the time slider, in seconds; the first step is "no lower limit", the last "no upper limit"
  // (every 5 minutes up to 2 hours, then bigger steps)
  const TIJDEN = [...Array.from({ length: 25 }, (_, i) => i * 300), 9000, 10800, 14400, 21600, 43200, null];
  const LAATSTE = TIJDEN.length - 1;
  const VAAK = 5; // makers with more logs than this are always shown; the rest behind "Meer namen"
  // how many makers: solo, duo, 3, team (4, as at the NK) and 5 or more
  const GROEPEN = [[1, "Solo"], [2, "Duo"], [3, "Drie"], [4, "Team"], [5, "5 of meer"]];
  const OPSLAG = "pz-overzicht-v4";
  const standaard = { zoek: "", stukjes: [], eigenaren: [], makers: [], samen: true, alleMakers: false, groep: [], moeilijk: [],
    van: 0, tot: LAATSTE, snelste: false, sort: "az", tekenaar: false, rating: true, alles: false };
  let st = { ...standaard };
  try { st = { ...standaard, ...JSON.parse(localStorage.getItem(OPSLAG) || "{}"), zoek: "" }; } catch (e) { /* private window */ }
  // the search term is not remembered, the filters and checkboxes are
  const bewaar = () => { try { localStorage.setItem(OPSLAG, JSON.stringify({ ...st, zoek: "" })); } catch (e) { /* ignore */ } };

  const ICON_CAMERA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>';
  const ICON_YOUTUBE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z"/></svg>';

  let D = null;          // data.json, prepared below
  const open = new Set(); // ids of opened pictures and versions, so a re-render keeps them open

  data()
    .then((d) => {
      D = voorbereiden(d);
      totalen(d);
      bouwFilters();
      koppel();
      teken();
    })
    .catch(() => {
      $("tiles").innerHTML = `<li class="empty">De gegevens konden niet worden geladen. Probeer het over een paar minuten opnieuw.</li>`;
      lijst.innerHTML = "";
    });

  // ---------------------------------------------------------------- data

  function voorbereiden(d) {
    const logsPer = {};
    for (const l of d.logs) (logsPer[l.exemplaar] = logsPer[l.exemplaar] || []).push(l);
    const exPer = {};
    for (const e of d.exemplaren) {
      e.logs = logsPer[e.id] || [];
      if (e.weg && !e.logs.length) continue; // boxes that are gone only show with their logs
      (exPer[e.afbeelding] = exPer[e.afbeelding] || []).push(e);
    }
    const afbeeldingen = d.afbeeldingen.map((a) => ({
      ...a,
      naam: a.en || a.nl,
      zoek: `${a.en} ${a.nl}`.toLowerCase(),
      zoekNamen: (a.namen || []).map((n) => [n, n.toLowerCase()]),
      verwant: a.verwant || [],
      exemplaren: (exPer[a.id] || []).sort((x, y) => x.eigenaren.join().localeCompare(y.eigenaren.join(), "nl")
        || x.volgnummer - y.volgnummer),
    }));
    afbeeldingen.sort((x, y) => x.naam.localeCompare(y.naam, "nl", { sensitivity: "base" }));
    // the filters are built from the data, so a new piece count or person shows up by itself
    const stukjes = [...new Set(d.exemplaren.map((e) => e.stukjes).filter(Boolean))].sort((x, y) => x - y);
    const eigenaren = [...new Set(d.exemplaren.flatMap((e) => e.eigenaren))].sort((x, y) => x.localeCompare(y, "nl"));
    const keer = {};
    for (const l of d.logs) for (const m of l.makers) keer[m] = (keer[m] || 0) + 1;
    const makers = Object.keys(keer).sort((x, y) => keer[y] - keer[x] || x.localeCompare(y, "nl"));
    return { afbeeldingen, stukjes, eigenaren, makers, keer };
  }

  function totalen(d) {
    const inBezit = d.exemplaren.filter((e) => e.eigenaren.length && !e.weg);
    const stukjesPer = Object.fromEntries(d.exemplaren.map((e) => [e.id, e.stukjes || 0]));
    const tegels = [
      [inBezit.length, "puzzels in bezit"],
      [new Set(inBezit.map((e) => e.afbeelding)).size, "verschillende afbeeldingen"],
      [d.logs.length, "puzzels gelegd"],
      // pieces actually put in place: minus the missing ones, when we know how many
      [d.logs.reduce((n, l) => n + Math.max(0, stukjesPer[l.exemplaar] - (l.missend || 0)), 0), "stukjes gelegd"],
    ];
    $("tiles").innerHTML = tegels.map(([n, label]) => `<li class="tile"><b>${esc(getal(n))}</b><span>${esc(label)}</span></li>`).join("");
    const t = new Date(d.updated);
    $("updated").textContent =
      `Bijgewerkt uit de Sheet op ${t.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })} om ${t.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
  }

  // ---------------------------------------------------------------- filters

  const chip = (key, v, label = v, extra = "") =>
    `<button type="button" class="chip" data-key="${key}" data-v="${esc(v)}" aria-pressed="${st[key].includes(v)}"${extra}>${esc(label)}</button>`;

  function bouwFilters() {
    for (const [key, waarden] of [["stukjes", D.stukjes], ["eigenaren", D.eigenaren], ["makers", D.makers]]) {
      st[key] = st[key].filter((v) => waarden.includes(v)); // a remembered name may be gone
    }
    $("f-stukjes").innerHTML = D.stukjes.map((v) => chip("stukjes", v)).join("");
    $("f-eigenaar").innerHTML = D.eigenaren.map((v) => chip("eigenaren", v)).join("");
    makerChips();
    $("f-groep").innerHTML = GROEPEN.map(([v, label]) => chip("groep", v, label)).join("");
    // difficulty 1-5, and 0 for pictures without a rating
    $("f-rating").innerHTML = [1, 2, 3, 4, 5, 0].map((v) => chip("moeilijk", v, v ? "★".repeat(v) : "Zonder rating",
      v ? ` aria-label="Rating ${v} van 5"` : "")).join("");
    $("f-van").max = $("f-tot").max = LAATSTE;
    $("f-van").value = st.van;
    $("f-tot").value = st.tot;
    $("snelste").checked = st.snelste;
    $("zoek").value = st.zoek;
    $("sort").value = st.sort;
    $("toon-tekenaar").checked = st.tekenaar;
    $("toon-rating").checked = st.rating;
    $("toon-alles").checked = st.alles;
  }

  // makers who did more than VAAK puzzles first (most first); the rest, unless chosen, behind "Meer namen"
  function makerChips() {
    const vaak = D.makers.filter((m) => D.keer[m] > VAAK || st.makers.includes(m));
    const rest = D.makers.length - vaak.length;
    const zichtbaar = st.alleMakers ? D.makers : vaak;
    $("f-makers").innerHTML = zichtbaar.map((m) => chip("makers", m, m, ` title="${D.keer[m]} keer gelegd"`)).join("")
      + (rest ? `<button type="button" class="chip meer" id="meer-makers">${st.alleMakers ? "Minder namen" : `Meer namen (${rest})`}</button>` : "");
  }

  function koppel() {
    document.querySelector(".filters").addEventListener("click", (ev) => {
      if (ev.target.id === "meer-makers") {
        st.alleMakers = !st.alleMakers;
        makerChips();
        return bewaar();
      }
      const b = ev.target.closest(".chip");
      if (!b) return;
      const key = b.dataset.key;
      const v = ["stukjes", "groep", "moeilijk"].includes(key) ? Number(b.dataset.v) : b.dataset.v;
      st[key] = st[key].includes(v) ? st[key].filter((x) => x !== v) : [...st[key], v];
      b.setAttribute("aria-pressed", st[key].includes(v));
      if (key === "makers") makerChips();
      wijzig();
    });
    let wacht = null;
    $("zoek").addEventListener("input", () => {
      clearTimeout(wacht);
      wacht = setTimeout(() => { st.zoek = $("zoek").value; wijzig(); }, 120);
    });
    // two handles: "van" can't pass "tot" and the other way round
    $("f-van").addEventListener("input", () => {
      st.van = Math.min(Number($("f-van").value), st.tot - 1);
      $("f-van").value = st.van;
      wijzig();
    });
    $("f-tot").addEventListener("input", () => {
      st.tot = Math.max(Number($("f-tot").value), st.van + 1);
      $("f-tot").value = st.tot;
      wijzig();
    });
    for (const id of ["samen", "los"]) $(id).addEventListener("change", () => { st.samen = $("samen").checked; wijzig(); });
    $("snelste").addEventListener("change", () => { st.snelste = $("snelste").checked; wijzig(); });
    $("sort").addEventListener("change", () => { st.sort = $("sort").value; wijzig(); });
    for (const [id, key] of [["toon-tekenaar", "tekenaar"], ["toon-rating", "rating"], ["toon-alles", "alles"]]) {
      $(id).addEventListener("change", () => { st[key] = $(id).checked; wijzig(); });
    }
    $("wis").addEventListener("click", () => {
      st = { ...st, zoek: "", stukjes: [], eigenaren: [], makers: [], groep: [], moeilijk: [], van: 0, tot: LAATSTE };
      bouwFilters();
      wijzig();
    });
    // remember which pictures and versions are open
    lijst.addEventListener("toggle", (ev) => {
      const id = ev.target.dataset && ev.target.dataset.id;
      if (id) ev.target.open ? open.add(id) : open.delete(id);
      uitklapLabel();
    }, true);
    // open (or close) every picture and version in the list, to see all times at once
    $("uitklap").addEventListener("click", () => {
      const alles = [...lijst.querySelectorAll("details[data-id]")];
      const dicht = alles.some((d) => !d.open);
      for (const d of alles) d.open = dicht;
    });
  }

  function uitklapLabel() {
    const alles = lijst.querySelectorAll("details[data-id]");
    $("uitklap").hidden = !alles.length;
    $("uitklap").textContent = [...alles].some((d) => !d.open) ? "Laat alle tijden zien" : "Alles inklappen";
  }

  function wijzig() {
    bewaar();
    teken();
  }

  function tijdLabel(van, tot) {
    if (van == null && tot == null) return "alle tijden";
    if (van == null) return `sneller dan ${tijd(tot)}`;
    if (tot == null) return `langer dan ${tijd(van)}`;
    return `tussen ${tijd(van)} en ${tijd(tot)}`;
  }

  // ---------------------------------------------------------------- render

  function teken() {
    const van = st.van > 0 ? TIJDEN[st.van] : null;
    const tot = TIJDEN[st.tot];
    $("tijd-out").textContent = tijdLabel(van, tot);
    const range = $("tijd-range");
    range.style.setProperty("--van", st.van / LAATSTE);
    range.style.setProperty("--tot", st.tot / LAATSTE);
    const tijdFilter = van != null || tot != null;
    // the option stays in place (greyed out without a time filter): showing it would move the page under a finger on the slider
    $("snelste-optie").classList.toggle("uit", !tijdFilter);
    $("snelste").disabled = !tijdFilter;
    // "fastest time counts": the time filter looks at the best time of each version (of the chosen makers),
    // so "longer than 1:00:00" finds versions never done under the hour, including versions not done yet
    const perVersie = tijdFilter && st.snelste;
    const binnen = (sec) => (van == null || sec >= van) && (tot == null || sec < tot);
    const aantalFilters = (st.stukjes.length > 0) + (st.eigenaren.length > 0) + (st.makers.length > 0)
      + (st.groep.length > 0) + (st.moeilijk.length > 0) + tijdFilter;
    $("nfilters").textContent = aantalFilters ? `(${aantalFilters})` : "";
    $("wis").hidden = !aantalFilters && !st.zoek;

    const logFilter = st.makers.length > 0 || st.groep.length > 0 || tijdFilter;
    // "samen" can only match when one of the chosen group sizes holds all chosen makers (Solo + 2 names never does);
    // then the option is hidden and "minstens één" applies, without forgetting the choice
    const samenKan = !st.groep.length || st.groep.some((g) => g >= 5 || g >= st.makers.length);
    const samen = st.samen && samenKan;
    $("makers-mode").hidden = st.makers.length < 2;
    $("samen-optie").hidden = !samenKan;
    $("samen").checked = samen;
    $("los").checked = !samen;
    const wie = samen ? (l) => st.makers.every((m) => l.makers.includes(m)) : (l) => !st.makers.length || st.makers.some((m) => l.makers.includes(m));
    const groep = (l) => !st.groep.length || st.groep.includes(Math.min(l.makers.length, 5));
    const maker = (l) => wie(l) && groep(l);
    const zoek = st.zoek.trim().toLowerCase();
    const treffers = zoeken(zoek);
    const zichtbaar = [];
    for (const a of D.afbeeldingen) {
      if (treffers && !treffers.has(a.id)) continue;
      if (st.moeilijk.length && !st.moeilijk.includes(a.rating || 0)) continue;
      const versies = new Map(); // stukjes -> [{ e, logs }]
      for (const e of a.exemplaren) {
        if (st.stukjes.length && !st.stukjes.includes(e.stukjes)) continue;
        if (st.eigenaren.length && !e.eigenaren.some((p) => st.eigenaren.includes(p))) continue;
        const logs = e.logs.filter((l) => maker(l) && (!tijdFilter || perVersie || (l.sec != null && binnen(l.sec))));
        if (logFilter && !perVersie && !logs.length) continue;
        if (!versies.has(e.stukjes)) versies.set(e.stukjes, []);
        versies.get(e.stukjes).push({ e, logs });
      }
      if (perVersie) {
        for (const [stukjes, exs] of versies) {
          const tijden = exs.flatMap((x) => x.logs).map((l) => l.sec).filter((s) => s != null);
          const best = tijden.length ? Math.min(...tijden) : null;
          if (best == null ? van == null : !binnen(best)) versies.delete(stukjes);
        }
      }
      const vs = [...versies].sort((x, y) => (x[0] || 0) - (y[0] || 0));
      const n = vs.reduce((s, [, exs]) => s + exs.reduce((t, x) => t + x.logs.length, 0), 0);
      // the most recent date of the shown logs ("" when never done or only without a date)
      const laatst = vs.reduce((s, [, exs]) => exs.reduce((t, x) => x.logs.reduce((u, l) => (l.datum > u ? l.datum : u), t), s), "");
      const t = treffers && treffers.get(a.id);
      if (vs.length) zichtbaar.push({ a, vs, n, t, laatst });
      else if (st.alles && !a.exemplaren.length && !st.eigenaren.length && !logFilter
        && (!st.stukjes.length || a.versies.some((v) => st.stukjes.includes(v)))) zichtbaar.push({ a, vs, n: 0, t, laatst: "" });
    }
    // stable sorts: the same count or date stays alphabetical
    if (st.sort === "minst" || st.sort === "meest") {
      const r = st.sort === "minst" ? 1 : -1;
      zichtbaar.sort((x, y) => r * (x.n - y.n));
    } else if (st.sort === "recent" || st.sort === "lang") {
      // puzzles without a date go last either way
      const r = st.sort === "recent" ? -1 : 1;
      zichtbaar.sort((x, y) => (!x.laatst - !y.laatst) || r * x.laatst.localeCompare(y.laatst));
    }
    if (treffers) zichtbaar.sort((x, y) => x.t.rang - y.t.rang); // title first, then other names, then related

    $("count").textContent = zichtbaar.length === 1 ? "1 puzzel" : `${getal(zichtbaar.length)} puzzels`;
    lijst.classList.toggle("met-rating", st.rating);
    lijst.innerHTML = zichtbaar.length
      ? zichtbaar.map(puzzel).join("")
      : `<li class="empty">Geen puzzels gevonden${aantalFilters ? " met deze filters" : ""}.</li>`;
    uitklapLabel();
  }

  // search: in the titles, in the other names JvH sold the picture under, and the pictures related to those hits
  // -> null without a search term, else Map(id -> {rang 0/1/2, noot})
  function zoeken(q) {
    if (!q) return null;
    const hits = new Map();
    for (const a of D.afbeeldingen) {
      if (a.zoek.includes(q)) hits.set(a.id, { rang: 0, noot: "" });
      else {
        const naam = a.zoekNamen.find(([, k]) => k.includes(q));
        if (naam) hits.set(a.id, { rang: 1, noot: `ook: ${naam[0]}` });
      }
    }
    const naam = Object.fromEntries(D.afbeeldingen.map((a) => [a.id, a]));
    for (const [id, h] of [...hits]) {
      if (h.rang === 2) continue;
      for (const v of naam[id].verwant) {
        if (!hits.has(v)) hits.set(v, { rang: 2, noot: `verwant aan ${naam[id].naam}` });
      }
    }
    return hits;
  }

  function puzzel({ a, vs, n, t, laatst }) {
    const meta = st.tekenaar && (a.tekenaar || a.jaar)
      ? ` <span class="meta">(${esc([a.tekenaar, a.jaar].filter(Boolean).join(", "))})</span>` : "";
    const nl = (a.nl && a.nl !== a.naam ? `<small>${esc(a.nl)}</small>` : "")
      + (t && t.noot ? `<small class="noot">${esc(t.noot)}</small>` : "")
      + ((st.sort === "recent" || st.sort === "lang") && laatst ? `<small class="noot">laatst gemaakt op ${datum(laatst)}</small>` : "");
    // stars and count always take their place, so the columns line up
    const rating = st.rating
      ? `<span class="stars"${a.rating ? ` title="Moeilijkheid ${a.rating} van 5" aria-label="Moeilijkheid ${a.rating} van 5"` : ""}>${sterren(a.rating)}</span>` : "";
    const aantal = `<span class="n"${n ? ` title="${n} keer gelegd"` : ' aria-hidden="true"'}>${n ? `${n}×` : ""}</span>`;
    const binnen = vs.length
      ? `<ul class="ex">${vs.map(([stukjes, exs]) => versie(a, stukjes, exs)).join("")}</ul>`
      : `<p class="leeg">Nog niet in onze collectie.${a.versies.length ? ` Bestaat in ${a.versies.join(", ")} stukjes.` : ""}</p>`;
    const extra = [
      a.opmerking ? `<span>${esc(a.opmerking)}</span>` : "",
      a.jvhUrl ? `<a href="${esc(a.jvhUrl)}" target="_blank" rel="noopener">Bekijk bij Jan van Haasteren ↗</a>` : "",
    ].filter(Boolean).join(" · ");
    return `<li class="pz"><details data-id="${esc(a.id)}"${open.has(a.id) ? " open" : ""}>
      <summary><span class="pz-naam"><b>${esc(a.naam)}</b>${meta}${nl}</span><span class="pz-rechts">${rating}${aantal}</span></summary>
      <div class="pz-body">${binnen}${extra ? `<p class="pz-extra">${extra}</p>` : ""}</div></details></li>`;
  }

  // a box as "Hanna² (−1)", "Simon (weg)" or "geen eigenaar"
  function doos(e) {
    const nr = e.volgnummer > 1 ? `<sup>${e.volgnummer}</sup>` : "";
    const missend = e.missend == null ? ' <span class="min">(−?)</span>' : e.missend ? ` <span class="min">(−${e.missend})</span>` : "";
    const weg = e.weg ? ' <span class="weg">(weg)</span>' : "";
    return `<span class="doos${e.weg ? " is-weg" : ""}">${e.eigenaren.length ? esc(e.eigenaren.join(" & ")) : "geen eigenaar"}${nr}${missend}${weg}</span>`;
  }

  // one version (piece count) with all its boxes; the times of all those boxes together, fastest first
  function versie(a, stukjes, exs) {
    const logs = exs.flatMap(({ e, logs }) => logs.map((l) => ({ l, e })));
    const meer = exs.length > 1;
    const regel = `<b>${stukjes || "?"}</b> ${exs.map(({ e }) => doos(e)).join('<span class="sep"> · </span>')}`
      + (logs.length ? ` <span class="keer">(${logs.length}x)</span>` : "");
    if (!logs.length) return `<li class="ex-regel">${regel}</li>`;
    logs.sort((x, y) => (x.l.sec ?? Infinity) - (y.l.sec ?? Infinity));
    const id = `${a.id}|${stukjes}`;
    return `<li><details data-id="${esc(id)}"${open.has(id) ? " open" : ""}>
      <summary>${regel}</summary><ol class="logs">${logs.map(({ l, e }) => log(l, meer ? e : null)).join("")}</ol></details></li>`;
  }

  function log(l, e) {
    const film = PZ.youtube(l.video)
      ? `<a class="film yt" href="${esc(l.video)}" target="_blank" rel="noopener" title="Bekijk de video" aria-label="Bekijk de video">${ICON_YOUTUBE}</a>`
      : l.gefilmd || l.video ? `<span class="film cam" title="Gefilmd, video komt nog" aria-label="Gefilmd, video komt nog">${ICON_CAMERA}</span>`
      : '<span class="film"></span>';
    const notities = [
      e ? `doos van ${e.eigenaren.length ? esc(e.eigenaren.join(" & ")) : "niemand"}${e.volgnummer > 1 ? ` (${e.volgnummer})` : ""}` : "",
      l.missend == null ? "niet compleet" : l.missend ? `${l.missend} missend` : "",
    ].filter(Boolean).join(" · ");
    return `<li><span class="t">${l.sec == null ? "geen tijd" : tijd(l.sec)}</span>
      <span class="wie">${esc(l.makers.join(", "))}${notities ? `<small>${notities}</small>` : ""}</span>
      <span class="wanneer">${l.datum ? datum(l.datum) : "onbekend"}</span>${film}</li>`;
  }
})();
