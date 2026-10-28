/* Puzzullu — overview page: totals, then every picture once in three levels (picture > boxes > times),
   with search, filters and sorting. Settings are remembered per device (localStorage). */
(function () {
  "use strict";

  const { esc, getal, tijd, datum, sterren, data } = window.PZ;
  const $ = (id) => document.getElementById(id);
  const lijst = $("lijst");

  // steps of the "faster than" slider, in seconds; the last step is "no limit"
  const TIJDEN = [900, 1800, 2700, 3600, 4500, 5400, 6300, 7200, 9000, 10800, 14400, 21600, 43200, null];
  const OPSLAG = "pz-overzicht";
  const standaard = { zoek: "", stukjes: [], eigenaren: [], makers: [], tijd: TIJDEN.length - 1, sort: "az",
    tekenaar: false, rating: false, alles: false };
  let st = { ...standaard };
  try { st = { ...standaard, ...JSON.parse(localStorage.getItem(OPSLAG) || "{}"), zoek: "" }; } catch (e) { /* private window */ }
  // the search term is not remembered, the filters and checkboxes are
  const bewaar = () => { try { localStorage.setItem(OPSLAG, JSON.stringify({ ...st, zoek: "" })); } catch (e) { /* ignore */ } };

  const ICON_CAMERA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>';
  const ICON_YOUTUBE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z"/></svg>';

  let D = null;          // data.json, prepared below
  const open = new Set(); // ids of opened pictures and boxes, so a re-render keeps them open

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
      exemplaren: (exPer[a.id] || []).sort((x, y) => (x.stukjes || 0) - (y.stukjes || 0)
        || x.eigenaren.join().localeCompare(y.eigenaren.join(), "nl") || x.volgnummer - y.volgnummer),
    }));
    afbeeldingen.sort((x, y) => x.naam.localeCompare(y.naam, "nl", { sensitivity: "base" }));
    const stukjes = [...new Set(d.exemplaren.map((e) => e.stukjes).filter(Boolean))].sort((x, y) => x - y);
    const eigenaren = [...new Set(d.exemplaren.flatMap((e) => e.eigenaren))].sort((x, y) => x.localeCompare(y, "nl"));
    const makers = [...new Set(d.logs.flatMap((l) => l.makers))].sort((x, y) => x.localeCompare(y, "nl"));
    return { afbeeldingen, stukjes, eigenaren, makers, updated: d.updated };
  }

  function totalen(d) {
    const inBezit = d.exemplaren.filter((e) => e.eigenaren.length && !e.weg);
    const stukjesPer = Object.fromEntries(d.exemplaren.map((e) => [e.id, e.stukjes || 0]));
    const tegels = [
      [inBezit.length, "puzzels in bezit"],
      [new Set(inBezit.map((e) => e.afbeelding)).size, "verschillende afbeeldingen"],
      [d.logs.length, "keer gelegd"],
      [d.logs.reduce((n, l) => n + stukjesPer[l.exemplaar], 0), "stukjes gelegd"],
    ];
    $("tiles").innerHTML = tegels.map(([n, label]) => `<li class="tile"><b>${esc(getal(n))}</b><span>${esc(label)}</span></li>`).join("");
    const t = new Date(d.updated);
    $("updated").textContent =
      `Bijgewerkt uit de Sheet op ${t.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })} om ${t.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
  }

  // ---------------------------------------------------------------- filters

  function bouwFilters() {
    const chips = (el, waarden, key, label = (v) => v) => {
      st[key] = st[key].filter((v) => waarden.includes(v)); // a remembered name may be gone
      $(el).innerHTML = waarden.map((v) =>
        `<button type="button" class="chip" data-key="${key}" data-v="${esc(v)}" aria-pressed="${st[key].includes(v)}">${esc(label(v))}</button>`).join("");
    };
    chips("f-stukjes", D.stukjes, "stukjes");
    chips("f-eigenaar", D.eigenaren, "eigenaren");
    chips("f-makers", D.makers, "makers");
    $("f-tijd").max = TIJDEN.length - 1;
    $("f-tijd").value = st.tijd;
    $("zoek").value = st.zoek;
    $("sort").value = st.sort;
    $("toon-tekenaar").checked = st.tekenaar;
    $("toon-rating").checked = st.rating;
    $("toon-alles").checked = st.alles;
  }

  function koppel() {
    document.querySelector(".filters").addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      const key = b.dataset.key;
      const v = key === "stukjes" ? Number(b.dataset.v) : b.dataset.v;
      st[key] = st[key].includes(v) ? st[key].filter((x) => x !== v) : [...st[key], v];
      b.setAttribute("aria-pressed", st[key].includes(v));
      wijzig();
    });
    let wacht = null;
    $("zoek").addEventListener("input", () => {
      clearTimeout(wacht);
      wacht = setTimeout(() => { st.zoek = $("zoek").value; wijzig(); }, 120);
    });
    $("f-tijd").addEventListener("input", () => { st.tijd = Number($("f-tijd").value); wijzig(); });
    $("sort").addEventListener("change", () => { st.sort = $("sort").value; wijzig(); });
    for (const [id, key] of [["toon-tekenaar", "tekenaar"], ["toon-rating", "rating"], ["toon-alles", "alles"]]) {
      $(id).addEventListener("change", () => { st[key] = $(id).checked; wijzig(); });
    }
    $("wis").addEventListener("click", () => {
      st = { ...st, zoek: "", stukjes: [], eigenaren: [], makers: [], tijd: TIJDEN.length - 1 };
      bouwFilters();
      wijzig();
    });
    // remember which pictures and boxes are open
    lijst.addEventListener("toggle", (ev) => {
      const id = ev.target.dataset && ev.target.dataset.id;
      if (id) ev.target.open ? open.add(id) : open.delete(id);
    }, true);
  }

  function wijzig() {
    bewaar();
    teken();
  }

  // ---------------------------------------------------------------- render

  function teken() {
    const grens = TIJDEN[st.tijd];
    $("tijd-out").textContent = grens == null ? "geen grens" : tijd(grens);
    const aantalFilters = (st.stukjes.length > 0) + (st.eigenaren.length > 0) + (st.makers.length > 0) + (grens != null);
    $("nfilters").textContent = aantalFilters ? `(${aantalFilters})` : "";
    $("wis").hidden = !aantalFilters && !st.zoek;

    const logFilter = st.makers.length > 0 || grens != null;
    const zoek = st.zoek.trim().toLowerCase();
    const zichtbaar = [];
    for (const a of D.afbeeldingen) {
      if (zoek && !a.zoek.includes(zoek)) continue;
      const exs = [];
      for (const e of a.exemplaren) {
        if (st.stukjes.length && !st.stukjes.includes(e.stukjes)) continue;
        if (st.eigenaren.length && !e.eigenaren.some((p) => st.eigenaren.includes(p))) continue;
        const logs = e.logs.filter((l) =>
          st.makers.every((m) => l.makers.includes(m)) && (grens == null || (l.sec != null && l.sec < grens)));
        if (logFilter && !logs.length) continue;
        exs.push({ e, logs });
      }
      const n = exs.reduce((s, x) => s + x.logs.length, 0);
      if (exs.length) zichtbaar.push({ a, exs, n });
      else if (st.alles && !a.exemplaren.length && !st.eigenaren.length && !logFilter
        && (!st.stukjes.length || a.versies.some((v) => st.stukjes.includes(v)))) zichtbaar.push({ a, exs, n: 0 });
    }
    if (st.sort !== "az") {
      const r = st.sort === "minst" ? 1 : -1;
      zichtbaar.sort((x, y) => r * (x.n - y.n)); // stable: same count stays alphabetical
    }

    $("count").textContent = zichtbaar.length === 1 ? "1 puzzel" : `${getal(zichtbaar.length)} puzzels`;
    lijst.innerHTML = zichtbaar.length
      ? zichtbaar.map(puzzel).join("")
      : `<li class="empty">Geen puzzels gevonden${aantalFilters ? " met deze filters" : ""}.</li>`;
  }

  function puzzel({ a, exs, n }) {
    const meta = st.tekenaar && (a.tekenaar || a.jaar)
      ? ` <span class="meta">(${esc([a.tekenaar, a.jaar].filter(Boolean).join(", "))})</span>` : "";
    const nl = a.nl && a.nl !== a.naam ? `<small>${esc(a.nl)}</small>` : "";
    const rating = st.rating && a.rating
      ? `<span class="stars" title="Moeilijkheid ${a.rating} van 5" aria-label="Moeilijkheid ${a.rating} van 5">${sterren(a.rating)}</span>` : "";
    const aantal = n ? `<span class="n" title="${n} keer gelegd">${n}×</span>` : "";
    const binnen = exs.length
      ? `<ul class="ex">${exs.map(exemplaar).join("")}</ul>`
      : `<p class="leeg">Nog niet in onze collectie.${a.versies.length ? ` Bestaat in ${a.versies.join(", ")} stukjes.` : ""}</p>`;
    const extra = [
      a.opmerking ? `<span>${esc(a.opmerking)}</span>` : "",
      a.jvhUrl ? `<a href="${esc(a.jvhUrl)}" target="_blank" rel="noopener">Bekijk bij Jan van Haasteren ↗</a>` : "",
    ].filter(Boolean).join(" · ");
    return `<li class="pz"><details data-id="${esc(a.id)}"${open.has(a.id) ? " open" : ""}>
      <summary><span class="pz-naam"><b>${esc(a.naam)}</b>${meta}${nl}</span><span class="pz-rechts">${rating}${aantal}</span></summary>
      <div class="pz-body">${binnen}${extra ? `<p class="pz-extra">${extra}</p>` : ""}</div></details></li>`;
  }

  function exemplaar({ e, logs }) {
    const missend = e.missend == null ? " <span class=\"min\">(−?)</span>" : e.missend ? ` <span class="min">(−${e.missend})</span>` : "";
    const nr = e.volgnummer > 1 ? `<sup>${e.volgnummer}</sup>` : "";
    const wie = e.eigenaren.length ? ` ${esc(e.eigenaren.join(" & "))}` : "";
    const weg = e.weg ? ' <span class="weg">(weg)</span>' : "";
    const keer = logs.length ? ` <span class="keer">(${logs.length}x)</span>` : "";
    const regel = `<b>${e.stukjes || "?"}</b>${nr}${missend}${wie}${weg}${keer}`;
    if (!logs.length) return `<li class="ex-regel${e.weg ? " is-weg" : ""}">${regel}</li>`;
    const gesorteerd = [...logs].sort((x, y) => (x.sec ?? Infinity) - (y.sec ?? Infinity));
    return `<li${e.weg ? ' class="is-weg"' : ""}><details data-id="${esc(e.id)}"${open.has(e.id) ? " open" : ""}>
      <summary>${regel}</summary><ol class="logs">${gesorteerd.map(log).join("")}</ol></details></li>`;
  }

  function log(l) {
    const film = l.video
      ? `<a class="film yt" href="${esc(l.video)}" target="_blank" rel="noopener" title="Bekijk de video" aria-label="Bekijk de video">${ICON_YOUTUBE}</a>`
      : l.gefilmd ? `<span class="film cam" title="Gefilmd, video komt nog" aria-label="Gefilmd, video komt nog">${ICON_CAMERA}</span>` : "";
    const missend = l.missend == null ? " · niet compleet" : l.missend ? ` · ${l.missend} missend` : "";
    return `<li><span class="t">${l.sec == null ? "geen tijd" : tijd(l.sec)}</span>
      <span class="wie">${esc(l.makers.join(", "))}</span>
      <span class="wanneer">${l.datum ? datum(l.datum) : "datum onbekend"}${missend}</span>${film}</li>`;
  }
})();
