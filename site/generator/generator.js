/* Puzzullu — the generator (/generator/): picks one random box we own, filtered on owner, pieces, difficulty and
   "nog niet gemaakt door" (per version: none of those people ever did this picture with this piece count).
   Filters are remembered per device (localStorage). */
(function () {
  "use strict";

  const { esc, getal, tijd, datum, sterren, data, admin } = window.PZ;
  const $ = (id) => document.getElementById(id);
  const VAAK = 5; // as on the overview: names with more than 5 logs first, the rest behind "Meer namen"
  const OPSLAG = "pz-generator-v1";
  const standaard = { eigenaren: [], stukjes: [], moeilijk: [], niet: [], samen: true, alleNamen: false };

  let st = { ...standaard };
  try { st = { ...standaard, ...JSON.parse(localStorage.getItem(OPSLAG) || "{}") }; } catch (e) { /* private window */ }
  const bewaar = () => { try { localStorage.setItem(OPSLAG, JSON.stringify(st)); } catch (e) { /* ignore */ } };

  let D = null;
  let vorige = null; // the box shown now, so "Nog een keer" picks another one

  const versie = (afb, stukjes) => `${afb}|${stukjes}`;
  const telOp = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
  const opAantal = (tel) => Object.keys(tel).sort((x, y) => tel[y] - tel[x] || x.localeCompare(y, "nl"));

  function voorbereiden(d) {
    const afb = Object.fromEntries(d.afbeeldingen.map((a) => [a.id, a]));
    const ex = Object.fromEntries(d.exemplaren.map((e) => [e.id, e]));
    const dozen = d.exemplaren.filter((e) => !e.weg && afb[e.afbeelding]);
    // per version: who did it, how often, the best time and the last date
    const gedaan = {};
    const keer = {};
    for (const l of d.logs) {
      const e = ex[l.exemplaar];
      for (const m of l.makers) telOp(keer, m);
      if (!e) continue;
      const v = (gedaan[versie(e.afbeelding, e.stukjes)] ||= { wie: [], n: 0, best: null, laatst: "" });
      v.wie.push(l.makers);
      v.n += 1;
      if (l.sec != null && (v.best == null || l.sec < v.best)) v.best = l.sec;
      if (l.datum > v.laatst) v.laatst = l.datum;
    }
    const perEigenaar = {};
    for (const e of dozen) for (const o of e.eigenaren) telOp(perEigenaar, o);
    const stukjes = [...new Set(dozen.map((e) => e.stukjes).filter(Boolean))].sort((x, y) => x - y);
    return { afb, dozen, gedaan, keer, eigenaren: opAantal(perEigenaar), makers: opAantal(keer), stukjes };
  }

  // ---------------------------------------------------------------- filters

  const chip = (key, v, label = v, extra = "") =>
    `<button type="button" class="chip" data-key="${key}" data-v="${esc(v)}" aria-pressed="${st[key].includes(v)}"${extra}>${esc(label)}</button>`;

  function tekenFilters() {
    $("f-eigenaar").innerHTML = D.eigenaren.map((v) => chip("eigenaren", v)).join("");
    $("f-stukjes").innerHTML = D.stukjes.map((v) => chip("stukjes", v)).join("");
    $("f-rating").innerHTML = [1, 2, 3, 4, 5, 0].map((v) => chip("moeilijk", v, v ? "★".repeat(v) : "Zonder rating",
      v ? ` aria-label="Rating ${v} van 5"` : "")).join("");
    tekenNamen();
    $(st.samen ? "niet-samen" : "niet-los").checked = true;
  }

  function tekenNamen() {
    const vaak = D.makers.filter((m) => D.keer[m] > VAAK || st.niet.includes(m));
    const rest = D.makers.length - vaak.length;
    $("f-niet").innerHTML = (st.alleNamen ? D.makers : vaak).map((m) => chip("niet", m)).join("")
      + (rest ? `<button type="button" class="chip meer" id="meer-namen">${st.alleNamen ? "Minder namen" : `Meer namen (${rest})`}</button>` : "");
  }

  function kandidaten() {
    return D.dozen.filter((e) => {
      const a = D.afb[e.afbeelding];
      if (st.eigenaren.length && !e.eigenaren.some((o) => st.eigenaren.includes(o))) return false;
      if (st.stukjes.length && !st.stukjes.includes(e.stukjes)) return false;
      if (st.moeilijk.length && !st.moeilijk.includes(a.rating || 0)) return false;
      const v = D.gedaan[versie(e.afbeelding, e.stukjes)];
      // samen: never did it with all of them in one go (as a duo, team, ...); otherwise: none of them ever did it
      const deden = st.samen ? (wie) => st.niet.every((m) => wie.includes(m)) : (wie) => st.niet.some((m) => wie.includes(m));
      if (st.niet.length && v && v.wie.some(deden)) return false;
      return true;
    });
  }

  function telling() {
    const n = kandidaten().length;
    const actief = ["eigenaren", "stukjes", "moeilijk", "niet"].filter((k) => st[k].length).length;
    $("niet-mode").hidden = st.niet.length < 2;
    $("nfilters").textContent = actief ? `(${actief})` : "";
    $("count").textContent = n === 1 ? "De generator kiest uit 1 doos." : `De generator kiest uit ${getal(n)} dozen.`;
    $("kies").disabled = n === 0;
    if (!n) $("count").textContent = "Geen enkele doos past bij deze filters.";
  }

  document.querySelector(".filters").addEventListener("click", (ev) => {
    if (ev.target.id === "meer-namen") {
      st.alleNamen = !st.alleNamen;
      bewaar();
      return tekenNamen();
    }
    if (ev.target.id === "wis") {
      st = { ...standaard, alleNamen: st.alleNamen };
      bewaar();
      tekenFilters();
      return telling();
    }
    if (ev.target.name === "niet-mode") {
      st.samen = ev.target.value === "samen";
      bewaar();
      return telling();
    }
    const b = ev.target.closest(".chip[data-key]");
    if (!b) return;
    const key = b.dataset.key;
    const v = ["stukjes", "moeilijk"].includes(key) ? Number(b.dataset.v) : b.dataset.v;
    st[key] = st[key].includes(v) ? st[key].filter((x) => x !== v) : [...st[key], v];
    b.setAttribute("aria-pressed", st[key].includes(v));
    bewaar();
    telling();
  });

  // ---------------------------------------------------------------- the draw

  const naam = (a) => a.en || a.nl;
  const rustig = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function kaart(e) {
    const a = D.afb[e.afbeelding];
    const v = D.gedaan[versie(e.afbeelding, e.stukjes)];
    const wie = e.eigenaren.length ? `de doos van ${e.eigenaren.join(" & ")}` : "een doos zonder eigenaar";
    const mist = e.missend == null ? "Er missen stukjes (hoeveel weten we niet)."
      : e.missend ? `Er ${e.missend === 1 ? "mist 1 stukje" : `missen ${e.missend} stukjes`}.` : "";
    const gelegd = v
      ? `${v.n === 1 ? "1 keer" : `${v.n} keer`} gelegd${v.best != null ? `, snelste tijd ${tijd(v.best)}` : ""}${v.laatst ? `, het laatst op ${datum(v.laatst)}` : ""}.`
      : "Deze versie hebben we nog nooit gelegd.";
    return `<h2 class="lot-titel">${esc(naam(a))}</h2>`
      + (a.nl && a.nl !== naam(a) ? `<p class="lot-nl">${esc(a.nl)}</p>` : "")
      + `<p class="lot-doos"><b>${e.stukjes ? `${getal(e.stukjes)} stukjes` : "Onbekend aantal stukjes"}</b>, ${esc(wie)}${e.volgnummer > 1 ? ` (doos ${e.volgnummer})` : ""}</p>`
      + (a.rating ? `<p class="sterren" aria-label="Moeilijkheid ${a.rating} van 5">${sterren(a.rating)} <span class="muted">moeilijkheid</span></p>` : "")
      + `<p class="muted">${esc(gelegd)}${mist ? ` ${esc(mist)}` : ""}</p>`;
  }

  function trek() {
    const lijst = kandidaten();
    if (!lijst.length) return;
    const keus = lijst.length > 1 ? lijst.filter((e) => e !== vorige) : lijst;
    const e = keus[Math.floor(Math.random() * keus.length)];
    vorige = e;
    $("kies").textContent = "Nog een keer";
    $("naar-loggen").hidden = true;
    const klaar = () => {
      $("uitslag").innerHTML = kaart(e);
      $("uitslag").classList.remove("schud");
      if (admin.get()) {
        $("naar-loggen").href = `/loggen/?doos=${encodeURIComponent(e.id)}`;
        $("naar-loggen").hidden = false;
      }
      $("kies").disabled = false;
    };
    if (rustig() || lijst.length < 3) return klaar();
    // shuffle a few titles first, slowing down, then land on the pick
    $("kies").disabled = true;
    $("uitslag").classList.add("schud");
    let stap = 0;
    const tik = () => {
      if (stap++ >= 12) return klaar();
      const x = lijst[Math.floor(Math.random() * lijst.length)];
      $("uitslag").innerHTML = `<h2 class="lot-titel">${esc(naam(D.afb[x.afbeelding]))}</h2><p class="lot-doos muted">${x.stukjes ? `${getal(x.stukjes)} stukjes` : ""}</p>`;
      setTimeout(tik, 40 + stap * stap * 2);
    };
    tik();
  }

  $("kies").addEventListener("click", trek);

  data().then((d) => {
    D = voorbereiden(d);
    // drop remembered choices that no longer exist
    st.eigenaren = st.eigenaren.filter((v) => D.eigenaren.includes(v));
    st.stukjes = st.stukjes.filter((v) => D.stukjes.includes(v));
    st.niet = st.niet.filter((v) => D.makers.includes(v));
    tekenFilters();
    telling();
    $("uitslag").innerHTML = `<p class="muted">Kies je filters, of druk meteen op de knop.</p>`;
  }).catch(() => {
    $("uitslag").innerHTML = '<p class="fout">De puzzels konden niet geladen worden. Probeer het later nog een keer.</p>';
  });
})();
