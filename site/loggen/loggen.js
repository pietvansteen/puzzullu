/* Puzzullu — Loggen & beheer (/loggen/, behind the password): log a time, add or remove boxes, missing pieces,
   video links, ratings, and fetch the Sheet now. Every change goes through the API to the Sheet (Apps Script);
   the sync then updates data.json, and this page updates its own copy at once. */
(function () {
  "use strict";

  const { esc, tijd, datum, sterren, data, admin } = window.PZ;
  const $ = (id) => document.getElementById(id);
  const VAAK = 5; // as on the overview: names with more than 5 logs first, the rest behind "Meer namen"
  const JUICH = ["Goed gedaan!", "Wat een tempo!", "Kampioenswaardig!", "Puzzelpracht!", "Stukje voor stukje, top!",
    "Daar kan Jan van Haasteren trots op zijn!", "Lekker gelegd!", "Weer eentje af!"];

  let D = null;             // data.json, kept up to date after each save
  let schrijven = false;    // can the API save to the Sheet?

  // ---------------------------------------------------------------- start: password, then data

  const auth = () => ({ Authorization: `Bearer ${admin.get()}`, "Content-Type": "application/json" });

  async function start() {
    if (!admin.get()) return toonLogin();
    const r = await fetch("/api/auth", { headers: auth(), cache: "no-store" }).catch(() => null);
    if (r && r.status === 401) { admin.clear(); return toonLogin("Het wachtwoord klopt niet meer. Log opnieuw in."); }
    if (r && r.ok) schrijven = !!(await r.json()).schrijven;
    $("niet-schrijven").hidden = schrijven || !r;
    D = voorbereiden(await data());
    $("beheer").hidden = false;
    $("tijd-datum").value = vandaag();
    tekenMakers();
    tekenVideos();
    tekenLaatste();
    vanGenerator();
  }

  function toonLogin(fout) {
    $("login").hidden = false;
    $("login-fout").textContent = fout || "";
    $("wachtwoord").focus();
  }

  $("login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const t = $("wachtwoord").value.trim();
    const r = await fetch("/api/auth", { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" }).catch(() => null);
    if (!r) return ($("login-fout").textContent = "De server is niet bereikbaar.");
    if (!r.ok) return ($("login-fout").textContent = (await r.json().catch(() => ({}))).error || "Dat lukte niet.");
    admin.set(t);
    location.reload(); // so the menu shows "Loggen" too
  });

  // ---------------------------------------------------------------- data

  function voorbereiden(d) {
    const afb = Object.fromEntries(d.afbeeldingen.map((a) => [a.id, { ...a, naam: a.en || a.nl, zoek: `${a.en} ${a.nl} ${(a.namen || []).join(" ")}`.toLowerCase() }]));
    const keer = {};
    for (const l of d.logs) for (const m of l.makers) keer[m] = (keer[m] || 0) + 1;
    return { ...d, afb, keer };
  }

  const exVan = (afbId) => D.exemplaren.filter((e) => e.afbeelding === afbId);
  const doosNaam = (e) => `${e.stukjes || "?"}${e.volgnummer > 1 ? ` (doos ${e.volgnummer})` : ""} · ${e.eigenaren.length ? e.eigenaren.join(" & ") : "geen eigenaar"}`;
  const vandaag = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const reqId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const personen = () => Object.keys(D.keer).concat(D.personen || []).filter((v, i, a) => a.indexOf(v) === i)
    .sort((x, y) => (D.keer[y] || 0) - (D.keer[x] || 0) || x.localeCompare(y, "nl"));

  async function bewaar(pad, body) {
    if (!schrijven) throw new Error("Opslaan in de Sheet is nog niet ingesteld.");
    const r = await fetch(pad, { method: "POST", headers: auth(), body: JSON.stringify({ id: reqId(), ...body }) })
      .catch(() => { throw new Error("De server is niet bereikbaar. Probeer het zo nog een keer."); });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { admin.clear(); throw new Error("Het wachtwoord klopt niet meer. Herlaad de pagina en log opnieuw in."); }
    if (!r.ok || !j.ok) throw new Error(j.error || "Opslaan lukte niet.");
    return j;
  }

  // ---------------------------------------------------------------- tabs

  for (const b of document.querySelectorAll(".tabs [role=tab]")) {
    b.addEventListener("click", () => {
      for (const x of document.querySelectorAll(".tabs [role=tab]")) x.setAttribute("aria-selected", x === b);
      for (const p of document.querySelectorAll(".paneel")) p.hidden = p.dataset.paneel !== b.dataset.tab;
      if (b.dataset.tab === "videos") tekenVideos();
    });
  }

  // ---------------------------------------------------------------- search with suggestions (picture)

  function zoeker(inputId, lijstId, filter, kies) {
    const input = $(inputId), lijst = $(lijstId);
    const toon = () => {
      const q = input.value.trim().toLowerCase();
      const hits = q ? Object.values(D.afb).filter((a) => a.zoek.includes(q) && filter(a))
        .sort((x, y) => (x.naam.toLowerCase().startsWith(q) ? 0 : 1) - (y.naam.toLowerCase().startsWith(q) ? 0 : 1)
          || x.naam.localeCompare(y.naam, "nl")).slice(0, 8) : [];
      lijst.innerHTML = hits.map((a) => `<li><button type="button" data-id="${esc(a.id)}"><b>${esc(a.naam)}</b>${a.nl && a.nl !== a.naam ? `<small>${esc(a.nl)}</small>` : ""}</button></li>`).join("")
        || (q ? '<li class="geen">Niets gevonden</li>' : "");
      lijst.hidden = !q;
    };
    input.addEventListener("input", toon);
    input.addEventListener("focus", toon);
    lijst.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-id]");
      if (!b) return;
      input.value = D.afb[b.dataset.id].naam;
      lijst.hidden = true;
      kies(D.afb[b.dataset.id]);
    });
    document.addEventListener("click", (ev) => { if (!ev.target.closest(".zoekveld")) lijst.hidden = true; });
  }

  // name chips with "Meer namen" and a field for a new name
  function namenKiezer(boxId, nieuwId, knopId) {
    const gekozen = new Set();
    let alle = false;
    const box = $(boxId);
    const teken = () => {
      const lijst = personen();
      const vaak = lijst.filter((n) => (D.keer[n] || 0) > VAAK || gekozen.has(n));
      const toon = alle ? lijst : vaak;
      box.innerHTML = toon.map((n) => `<button type="button" class="chip" data-v="${esc(n)}" aria-pressed="${gekozen.has(n)}">${esc(n)}</button>`).join("")
        + (lijst.length > vaak.length ? `<button type="button" class="chip meer">${alle ? "Minder namen" : `Meer namen (${lijst.length - vaak.length})`}</button>` : "");
    };
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      if (b.classList.contains("meer")) alle = !alle;
      else gekozen.has(b.dataset.v) ? gekozen.delete(b.dataset.v) : gekozen.add(b.dataset.v);
      teken();
    });
    const voegToe = () => {
      let n = $(nieuwId).value.replace(/\s+/g, " ").trim().replace(/,/g, "");
      if (!n) return;
      n = n.charAt(0).toUpperCase() + n.slice(1);
      const bekend = personen().find((p) => p.toLowerCase() === n.toLowerCase());
      if (!bekend) (D.personen = D.personen || []).push(n);
      gekozen.add(bekend || n);
      alle = alle || !((D.keer[bekend || n] || 0) > VAAK);
      $(nieuwId).value = "";
      teken();
    };
    $(knopId).addEventListener("click", voegToe);
    $(nieuwId).addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); voegToe(); } });
    return { teken, gekozen: () => [...gekozen], leeg: () => { gekozen.clear(); teken(); } };
  }

  // ---------------------------------------------------------------- A. a time

  const makers = namenKiezer("tijd-makers", "tijd-nieuw", "tijd-nieuw-knop");
  const tekenMakers = () => makers.teken();
  let tijdAfb = null, tijdDoos = null;

  zoeker("tijd-zoek", "tijd-sugg", (a) => exVan(a.id).some((e) => !e.weg), kiesPuzzel);

  function kiesPuzzel(a) {
    tijdAfb = a;
    tijdDoos = null;
    const exs = exVan(a.id).filter((e) => !e.weg).sort((x, y) => (x.stukjes || 0) - (y.stukjes || 0));
    $("tijd-doos").hidden = false;
    $("tijd-dozen").innerHTML = exs.length
      ? exs.map((e) => `<label><input type="radio" name="doos" value="${esc(e.id)}"${exs.length === 1 ? " checked" : ""}> ${esc(doosNaam(e))}${missendTekst(e)}</label>`).join("")
      : '<p class="muted">Niemand heeft deze puzzel (meer). Voeg eerst een doos toe bij Dozen.</p>';
    if (exs.length === 1) kiesDoos(exs[0]);
  }

  // the last log entered (highest number), so you can see what is in already
  function tekenLaatste() {
    const nr = (l) => Number(String(l.id).replace(/\D/g, "")) || 0;
    const l = D.logs.reduce((x, y) => (!x || nr(y) > nr(x) ? y : x), null);
    const e = l && D.exemplaren.find((x) => x.id === l.exemplaar);
    $("laatst-log").hidden = !e;
    if (!e) return;
    const a = D.afb[e.afbeelding];
    const naam = `<b>${esc(a ? a.naam : e.afbeelding)}</b>`;
    // when it was entered (column ingevoerd_op; older logs don't have it)
    const [dag, uur] = (l.ingevoerd || "").split("T");
    $("laatst-log").innerHTML = `<span class="muted">Laatst gelogd:</span> `
      + (a && a.jvhUrl ? `<a href="${esc(a.jvhUrl)}" target="_blank" rel="noopener" title="Bekijk bij Jan van Haasteren">${naam} ↗</a>` : naam)
      + ` <span class="muted">(${esc(doosNaam(e))})</span><br>`
      + [l.sec != null ? tijd(l.sec) : "zonder tijd", l.makers.join(", "), datum(l.datum)].filter(Boolean).map(esc).join(" · ")
      + (dag ? `<small class="muted">Ingevoerd op ${esc(datum(dag))}${uur ? ` om ${esc(uur)}` : ""}</small>` : "");
  }

  // from the generator: /loggen/?doos=<id> chooses that box
  function vanGenerator() {
    const e = D.exemplaren.find((x) => x.id === new URLSearchParams(location.search).get("doos") && !x.weg);
    if (!e || !D.afb[e.afbeelding]) return;
    $("tijd-zoek").value = D.afb[e.afbeelding].naam;
    kiesPuzzel(D.afb[e.afbeelding]);
    const r = document.querySelector(`input[name=doos][value="${CSS.escape(e.id)}"]`);
    if (r) { r.checked = true; kiesDoos(e); }
  }

  const missendTekst = (e) => (e.missend == null ? ' <span class="min">(−?)</span>' : e.missend ? ` <span class="min">(−${e.missend})</span>` : "");

  $("tijd-dozen").addEventListener("change", (ev) => {
    const e = D.exemplaren.find((x) => x.id === ev.target.value);
    if (e) kiesDoos(e);
  });

  // the box decides what "compleet" means: with missing pieces it is "weer compleet, stukje gevonden"
  function kiesDoos(e) {
    tijdDoos = e;
    const mist = e.missend == null || e.missend > 0;
    $("compleet-label").textContent = mist ? "Weer compleet, stukje gevonden" : "Compleet";
    $("tijd-mist").value = e.missend || "";
    document.querySelector(`input[name=compleet][value=${mist ? "mist" : "ja"}]`).checked = true;
  }

  $("tijd-mist").addEventListener("input", () => { document.querySelector("input[name=compleet][value=mist]").checked = true; });
  $("t-geen").addEventListener("change", () => { for (const id of ["t-u", "t-m", "t-s"]) $(id).disabled = $("t-geen").checked; });

  $("p-tijd").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fout = (t) => { $("tijd-fout").textContent = t; };
    fout("");
    if (!tijdDoos) return fout("Kies een puzzel en een doos.");
    const wie = makers.gekozen();
    if (!wie.length) return fout("Kies wie hem gelegd heeft.");
    let t = "";
    if (!$("t-geen").checked) {
      const [u, m, s] = ["t-u", "t-m", "t-s"].map((id) => $(id).value.trim());
      if (!u && !m && !s) return fout("Vul de tijd in, of vink 'Zonder tijd' aan.");
      const [nu, nm, ns] = [u || 0, m || 0, s || 0].map(Number);
      if (![nu, nm, ns].every(Number.isInteger) || nm > 59 || ns > 59 || nu < 0) return fout("De tijd klopt niet (minuten en seconden tot 59).");
      if (nu + nm + ns === 0) return fout("Een tijd van 0:00:00? Dat is wel heel snel.");
      t = `${nu}:${String(nm).padStart(2, "0")}:${String(ns).padStart(2, "0")}`;
    }
    const d = $("tijd-datum").value;
    if (!d) return fout("Kies een datum.");
    const compleet = document.querySelector("input[name=compleet]:checked").value;
    const mist = Number($("tijd-mist").value);
    if (compleet === "mist" && !(Number.isInteger(mist) && mist > 0)) return fout("Hoeveel stukjes missen er?");
    const body = { exemplaar_id: tijdDoos.id, tijd: t, datum: d, makers: wie, compleet: compleet === "ja" ? "ja" : mist,
      gefilmd: $("tijd-gefilmd").checked, missend: compleet === "ja" ? 0 : mist };

    const knop = ev.submitter || $("p-tijd").querySelector("button[type=submit]");
    knop.disabled = true;
    knop.textContent = "Opslaan…";
    try {
      const r = await bewaar("/api/log", body);
      const sec = t ? t.split(":").reduce((n, x) => n * 60 + Number(x), 0) : null;
      const nieuw = { id: r.log_id, exemplaar: tijdDoos.id, sec, datum: d, makers: [...wie].sort((x, y) => x.localeCompare(y, "nl")),
        missend: body.compleet === "ja" ? 0 : mist, gefilmd: body.gefilmd, video: "",
        ingevoerd: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) };
      feest(nieuw, tijdDoos, tijdAfb);
      D.logs.push(nieuw);
      for (const m of nieuw.makers) D.keer[m] = (D.keer[m] || 0) + 1;
      tijdDoos.missend = body.missend;
      // empty the form for the next one, keep the date and the people
      for (const id of ["t-u", "t-m", "t-s", "tijd-zoek"]) $(id).value = "";
      $("tijd-gefilmd").checked = false;
      $("tijd-doos").hidden = true;
      tijdAfb = tijdDoos = null;
      tekenVideos();
      tekenLaatste();
    } catch (e) {
      fout(e.message);
    } finally {
      knop.disabled = false;
      knop.textContent = "Opslaan";
    }
  });

  // ---------------------------------------------------------------- after saving: cheers, NK, records

  const CAT = { 1: "solo", 2: "duo", 4: "team" };
  // group sizes as on the overview: 1, 2, 3, 4, and 5 or more together
  const GROOTTE = { 1: "solo", 2: "als duo", 3: "met z'n drieën", 4: "als team", 5: "met 5 of meer" };
  const grootte = (l) => Math.min(l.makers.length, 5);

  function verschil(sec) {
    const u = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    if (u) return `${u} uur${m ? ` en ${m} ${m === 1 ? "minuut" : "minuten"}` : ""}`;
    if (m) return `${m} ${m === 1 ? "minuut" : "minuten"}${m < 5 && s ? ` en ${s} seconden` : ""}`;
    return `${s} seconden`;
  }

  function feest(l, e, a) {
    const regels = [`<p class="groot">${JUICH[Math.floor(Math.random() * JUICH.length)]} 🎉</p>`,
      `<p><b>${esc(a.naam)}</b> (${e.stukjes || "?"} stukjes)${l.sec != null ? ` in <b>${tijd(l.sec)}</b>` : ""} is opgeslagen.</p>`];
    if (l.sec != null) {
      // compare only like with like: the same version (picture + pieces) and the same number of people
      const wie = GROOTTE[grootte(l)];
      const versie = new Set(D.exemplaren.filter((x) => x.afbeelding === e.afbeelding && x.stukjes === e.stukjes).map((x) => x.id));
      const eerder = D.logs.filter((x) => versie.has(x.exemplaar) && x.sec != null && grootte(x) === grootte(l));
      // the previous time: the most recent one up to the date of this log
      const vorige = eerder.filter((x) => !l.datum || !x.datum || x.datum <= l.datum)
        .sort((x, y) => (x.datum || "").localeCompare(y.datum || "") || x.id.localeCompare(y.id)).pop();
      if (vorige) {
        const d = l.sec - vorige.sec;
        const wanneer = `${tijd(vorige.sec)}${vorige.datum ? ` op ${datum(vorige.datum)}` : ""}${vorige.makers.join() !== l.makers.join() ? `, ${esc(vorige.makers.join(", "))}` : ""}`;
        regels.push(d === 0 ? `<p>⏱️ Precies even snel als de vorige keer ${wie} (${wanneer}).</p>`
          : `<p>⏱️ ${verschil(Math.abs(d))} ${d < 0 ? "sneller" : "langzamer"} dan de vorige keer ${wie} (${wanneer}).</p>`);
      }
      const snelst = Math.min(...eerder.map((x) => x.sec));
      const team = eerder.filter((x) => x.makers.join() === l.makers.join());
      const teamSnelst = Math.min(...team.map((x) => x.sec));
      if (!eerder.length) regels.push(`<p>De eerste tijd ${wie} op deze puzzel.</p>`);
      else if (l.sec < snelst) regels.push(`<p>🏆 Snelste tijd ooit ${wie} op deze puzzel! Het oude record was ${tijd(snelst)}.</p>`);
      else if (team.length && l.sec < teamSnelst) regels.push(`<p>⭐ Persoonlijk record met deze groep! Vorige keer op z'n snelst ${tijd(teamSnelst)}.</p>`);
      // the NK: only with as many people as the category (solo 1, duo 2, team 4) and the same number of pieces
      const cat = CAT[l.makers.length];
      const nk = cat ? (D.nk || []).filter((n) => n.afbeelding === e.afbeelding && n.categorie === cat && n.stukjes && n.stukjes === e.stukjes) : [];
      if (nk.length) {
        const n = nk.reduce((b, x) => (Math.abs(x.sec - l.sec) < Math.abs(b.sec - l.sec) ? x : b));
        const wat = `de nummer 1 van de ${n.ronde || "wedstrijd"} van het NK ${n.jaar || ""}`.replace(/\s+$/, "");
        regels.push(l.sec <= n.sec
          ? `<p>🥇 Je was ${verschil(n.sec - l.sec)} sneller dan ${wat} (${tijd(n.sec)})!</p>`
          : `<p>Je zat ${verschil(l.sec - n.sec)} van ${wat} (${tijd(n.sec)}).</p>`);
      }
    }
    regels.push('<p class="muted">De site is over een halve minuut bijgewerkt.</p>');
    $("feest-tekst").innerHTML = regels.join("");
    $("feest").showModal();
  }

  // ---------------------------------------------------------------- B. boxes

  const eigenaren = namenKiezer("doos-eigenaren", "doos-nieuw", "doos-nieuw-knop");
  let doosAfb = null, doosStukjes = null;

  zoeker("doos-zoek", "doos-sugg", () => true, (a) => {
    doosAfb = a;
    doosStukjes = null;
    $("doos-info").hidden = false;
    $("doos-naam").textContent = a.naam;
    tekenDozen();
    $("doos-versies").innerHTML = (a.versies || []).map((v) => `<button type="button" class="chip" data-v="${v}" aria-pressed="false">${v}</button>`).join("")
      || '<span class="muted">JvH kent geen aantallen voor deze puzzel; vul het zelf in.</span>';
    $("doos-stukjes").value = "";
    eigenaren.teken();
    hint();
  });

  function tekenDozen() {
    const exs = exVan(doosAfb.id).sort((x, y) => (x.stukjes || 0) - (y.stukjes || 0));
    $("doos-lijst").innerHTML = exs.length ? exs.map((e) => `<li data-id="${esc(e.id)}" class="${e.weg ? "is-weg" : ""}">
        <span>${esc(doosNaam(e))}${missendTekst(e)}${e.weg ? ' <span class="weg">(weg)</span>' : ""}</span>
        ${e.weg ? "" : `<span class="acties">
          <label>Mist <input type="number" class="klein-getal" min="0" max="9999" value="${e.missend ?? ""}" aria-label="Missende stukjes"></label>
          <button type="button" class="knop klein" data-actie="missend">Opslaan</button>
          <button type="button" class="knop klein rood" data-actie="weg">Weghalen</button></span>`}
      </li>`).join("") : '<li class="muted">Nog niemand heeft deze puzzel.</li>';
  }

  $("doos-lijst").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-actie]");
    if (!b) return;
    const li = b.closest("li"), e = D.exemplaren.find((x) => x.id === li.dataset.id);
    $("doos-fout").textContent = "";
    try {
      if (b.dataset.actie === "weg") {
        if (!confirm(`${doosNaam(e)} weghalen? De doos blijft in de Sheet met status "weg", zodat de tijden blijven bestaan.`)) return;
        b.disabled = true;
        await bewaar("/api/exemplaar/weg", { exemplaar_id: e.id });
        e.weg = true;
      } else {
        const n = Number(li.querySelector("input").value);
        if (!Number.isInteger(n) || n < 0) throw new Error("Vul een aantal missende stukjes in (0 = compleet).");
        b.disabled = true;
        await bewaar("/api/missend", { exemplaar_id: e.id, missend: n });
        e.missend = n;
      }
      tekenDozen();
    } catch (err) {
      $("doos-fout").textContent = err.message;
      b.disabled = false;
    }
  });

  $("doos-versies").addEventListener("click", (ev) => {
    const b = ev.target.closest(".chip");
    if (!b) return;
    doosStukjes = doosStukjes === Number(b.dataset.v) ? null : Number(b.dataset.v);
    for (const x of $("doos-versies").querySelectorAll(".chip")) x.setAttribute("aria-pressed", Number(x.dataset.v) === doosStukjes);
    $("doos-stukjes").value = "";
    hint();
  });
  $("doos-stukjes").addEventListener("input", () => {
    doosStukjes = Number($("doos-stukjes").value) || null;
    for (const x of $("doos-versies").querySelectorAll(".chip")) x.setAttribute("aria-pressed", "false");
    hint();
  });
  $("doos-eigenaren").addEventListener("click", () => setTimeout(hint));

  // "this will be box 2" when the same owner(s) already have this version
  function hint() {
    const wie = eigenaren.gekozen().sort((x, y) => x.localeCompare(y, "nl")).join();
    const zelfde = doosAfb && doosStukjes && wie ? exVan(doosAfb.id).filter((e) => e.stukjes === doosStukjes && e.eigenaren.join() === wie) : [];
    $("doos-hint").textContent = zelfde.length ? `Deze eigenaar heeft deze versie al; dit wordt doos ${Math.max(...zelfde.map((e) => e.volgnummer)) + 1}.` : "";
  }

  $("doos-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fout = (t) => { $("doos-fout").textContent = t; };
    fout("");
    if (!doosAfb) return fout("Kies een puzzel.");
    if (!doosStukjes || !Number.isInteger(doosStukjes)) return fout("Kies of vul het aantal stukjes in.");
    const wie = eigenaren.gekozen();
    if (!wie.length) return fout("Kies van wie de doos is.");
    const knop = ev.submitter || $("doos-form").querySelector("button[type=submit]");
    knop.disabled = true;
    try {
      const r = await bewaar("/api/exemplaar", { afbeelding_id: doosAfb.id, stukjes: doosStukjes, eigenaren: wie });
      D.exemplaren.push({ id: r.exemplaar_id, afbeelding: doosAfb.id, stukjes: doosStukjes, eigenaren: [...wie].sort((x, y) => x.localeCompare(y, "nl")),
        volgnummer: r.volgnummer || 1, missend: 0, weg: false });
      eigenaren.leeg();
      tekenDozen();
      hint();
      fout("");
      $("doos-hint").textContent = `Toegevoegd: ${doosNaam(D.exemplaren[D.exemplaren.length - 1])}.`;
    } catch (e) {
      fout(e.message);
    } finally {
      knop.disabled = false;
    }
  });

  // ---------------------------------------------------------------- C. video links

  function tekenVideos() {
    const ex = Object.fromEntries(D.exemplaren.map((e) => [e.id, e]));
    const open = D.logs.filter((l) => l.gefilmd && !l.video).sort((x, y) => (y.datum || "").localeCompare(x.datum || ""));
    $("video-lijst").innerHTML = open.length ? open.map((l) => {
      const e = ex[l.exemplaar] || {}, a = D.afb[e.afbeelding] || {};
      return `<li data-id="${esc(l.id)}"><div><b>${esc(a.naam || l.exemplaar)}</b> ${e.stukjes || ""}
          <small>${l.sec != null ? tijd(l.sec) : "geen tijd"} · ${esc(l.makers.join(", "))} · ${l.datum ? datum(l.datum) : "datum onbekend"}</small></div>
        <div class="nieuw-naam"><input type="url" placeholder="https://youtu.be/…" aria-label="Video-link"><button type="button" class="knop klein">Opslaan</button></div>
        <p class="fout" role="alert"></p></li>`;
    }).join("") : '<li class="muted">Alle gefilmde puzzels hebben een link. 🎬</li>';
  }

  $("video-lijst").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const li = b.closest("li"), url = li.querySelector("input").value.trim();
    li.querySelector(".fout").textContent = "";
    if (!PZ.youtube(url)) {
      li.querySelector(".fout").textContent = "Plak een YouTube-link, zoals https://youtu.be/… of https://www.youtube.com/watch?v=…";
      return;
    }
    b.disabled = true;
    try {
      await bewaar("/api/video", { log_id: li.dataset.id, video_url: url });
      D.logs.find((l) => l.id === li.dataset.id).video = url;
      li.innerHTML = `<p>✅ Link opgeslagen bij ${esc(li.querySelector("b").textContent)}.</p>`;
    } catch (e) {
      li.querySelector(".fout").textContent = e.message;
      b.disabled = false;
    }
  });

  // ---------------------------------------------------------------- D. ratings

  let ratingAfb = null;
  zoeker("rating-zoek", "rating-sugg", () => true, (a) => {
    ratingAfb = a;
    $("rating-info").hidden = false;
    $("rating-naam").textContent = a.naam;
    tekenRating();
  });

  function tekenRating() {
    const r = ratingAfb.rating || 0;
    $("rating-sterren").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" aria-pressed="${n === r}" aria-label="${n} van 5">${sterren(n)}</button>`).join("")
      + `<button type="button" data-v="" class="link-btn"${r ? "" : " hidden"}>Rating wissen</button>`;
  }

  $("rating-sterren").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const r = b.dataset.v ? Number(b.dataset.v) : null;
    $("rating-fout").textContent = "";
    try {
      await bewaar("/api/rating", { afbeelding_id: ratingAfb.id, rating: r });
      ratingAfb.rating = r;
      tekenRating();
      $("rating-fout").textContent = r ? `Opgeslagen: ${sterren(r)}` : "Rating gewist.";
    } catch (e) {
      $("rating-fout").textContent = e.message;
    }
  });

  // ---------------------------------------------------------------- E. the rest

  for (const [id, pad, tekst] of [["nu-sync", "/api/sync", "De site haalt de Sheet nu op; over een halve minuut is alles bijgewerkt."],
    ["nu-jvh", "/api/jvh", "De JvH-catalogus en de Sheet worden nu opgehaald; dat duurt hooguit een minuut."]]) {
    $(id).addEventListener("click", async () => {
      const r = await fetch(pad, { method: "POST", headers: auth() }).catch(() => null);
      $("overig-melding").textContent = r && r.ok ? tekst : "Dat lukte niet. Probeer het zo nog een keer.";
    });
  }

  $("uitloggen").addEventListener("click", () => {
    admin.clear();
    location.href = "/";
  });

  start().catch(() => {
    $("beheer").hidden = true;
    toonLogin("De gegevens konden niet worden geladen. Probeer het over een paar minuten opnieuw.");
  });
})();
