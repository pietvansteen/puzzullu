/* Puzzullu — badges (window.PZB): which badges a person has, at which rank, and since which log; and the badge
   pictures (the logo's puzzle piece in wood, bronze, silver, gold or diamond, a little drawing in the middle).
   Needs shared.js (window.PZ) and rekenen.js (window.PZR) first.

   Every badge walks through the person's logs in order (date, then log id) and keeps a number up to date:
   a count, a longest streak, a best time. A rank is reached at the log where that number first passes its
   threshold, so every rank has a date and a puzzle. A log counts for all of its makers. */
(function () {
  "use strict";

  const { esc, getal, tijd, datum } = window.PZ;
  const R = window.PZR;

  const RANGEN = ["Hout", "Brons", "Zilver", "Goud", "Diamant"];
  const u = (h, m = 0) => h * 3600 + m * 60;
  const telwoord = (een, meer) => (n) => `${getal(n)} ${n === 1 ? een : meer}`;
  const dag = (iso) => new Date(`${iso}T12:00:00`).getDay(); // 0 = Sunday
  const md = (iso) => iso.slice(5); // "12-24"

  // ---------------------------------------------------------------- calendar helpers for the holidays

  const isoVan = (j, m, d) => new Date(Date.UTC(j, m - 1, d)).toISOString().slice(0, 10);
  const plus = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
  const tussen = (iso, van, tot) => iso >= van && iso <= tot;
  // the n-th weekday (0 = Sunday) of a month, e.g. the 4th Thursday of November
  function nde(j, m, wd, n) {
    const eerste = new Date(Date.UTC(j, m - 1, 1)).getUTCDay();
    return isoVan(j, m, 1 + ((wd - eerste + 7) % 7) + (n - 1) * 7);
  }
  // Easter Sunday (anonymous Gregorian algorithm)
  function pasen(j) {
    const a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const maand = Math.floor((h + l - 7 * m + 114) / 31), dg = ((h + l - 7 * m + 114) % 31) + 1;
    return isoVan(j, maand, dg);
  }
  const SONGFESTIVAL = { 2021: "2021-05-22", 2022: "2022-05-14", 2023: "2023-05-13", 2024: "2024-05-11", 2025: "2025-05-17", 2026: "2026-05-16", 2027: "2027-05-15" };
  const TOUR = { 2021: ["06-26", "07-18"], 2022: ["07-01", "07-24"], 2023: ["07-01", "07-23"], 2024: ["06-29", "07-21"], 2025: ["07-05", "07-27"], 2026: ["07-04", "07-26"] };

  // ---------------------------------------------------------------- holiday badges: the puzzle that goes with the day, on or around that day

  const FEEST = [
    { id: "kerst", naam: "Kerstpuzzel", glyph: "kerstboom", kleur: "#2e9e5b", periode: "tussen 24 en 26 december",
      puzzels: ["kerstmis", "kerstavond", "kerstdiner", "kerstkriebels", "kerst-koopjes", "kerstbomenmarkt"],
      past: (iso) => tussen(md(iso), "12-24", "12-26") },
    { id: "advent", naam: "Adventspuzzel", glyph: "kaars", kleur: "#c0392b", periode: "tussen 1 en 24 december",
      puzzels: ["kerst-advent-kalender", "kerst-advent-kalender-2025", "kerst-advent-kalender-2025-1", "kerst-advent-kalender-2026"],
      past: (iso) => tussen(md(iso), "12-01", "12-24") },
    { id: "sinterklaas", naam: "Sinterklaas", glyph: "mijter", kleur: "#d63a3a", periode: "rond de intocht (de derde zaterdag vóór 5 december, een dag eerder of later mag ook)",
      puzzels: ["sinterklaas-intocht"],
      past: (iso) => {
        const j = +iso.slice(0, 4), vijf = new Date(Date.UTC(j, 11, 5)).getUTCDay();
        const intocht = plus(isoVan(j, 12, 5), -((vijf + 1) % 7 || 7) - 14); // the last Saturday before 5 December, minus two weeks
        return tussen(iso, plus(intocht, -1), plus(intocht, 1));
      } },
    { id: "koningsdag", naam: "Koningsdag", glyph: "kroon", kleur: "#ff8a1f", periode: "tussen 24 en 30 april",
      puzzels: ["koningsdag", "de-vrijmarkt"], past: (iso) => tussen(md(iso), "04-24", "04-30") },
    { id: "midsommar", naam: "Midsommar", glyph: "krans", kleur: "#e86fa3", periode: "in het midzomerweekend (de vrijdag tussen 19 en 25 juni, tot en met zondag)",
      puzzels: ["midzomerfeest"],
      past: (iso) => { const vr = nde(+iso.slice(0, 4), 6, 5, 3); const v = tussen(vr, `${iso.slice(0, 4)}-06-19`, `${iso.slice(0, 4)}-06-25`) ? vr : plus(vr, 7); return tussen(iso, v, plus(v, 2)); } },
    { id: "vrijdag13", naam: "Vrijdag de 13e", glyph: "kat", kleur: "#3b3b4f", periode: "op een vrijdag de 13e",
      puzzels: ["vrijdag-de-13e"], past: (iso) => iso.slice(8) === "13" && dag(iso) === 5 },
    { id: "blackfriday", naam: "Black Friday", glyph: "kaartje", kleur: "#26262e", periode: "in het Black Friday-weekend (de vrijdag na de vierde donderdag van november, tot en met zondag)",
      puzzels: ["black-friday"], past: (iso) => { const v = plus(nde(+iso.slice(0, 4), 11, 4, 4), 1); return tussen(iso, v, plus(v, 2)); } },
    { id: "oudnieuw", naam: "Oud en nieuw", glyph: "vuurwerk", kleur: "#7b4fd6", periode: "op 31 december of 1 januari",
      puzzels: ["oud-en-nieuw-feestje", "op-het-nieuwe-jaar"], past: (iso) => md(iso) === "12-31" || md(iso) === "01-01" },
    { id: "duik", naam: "Nieuwjaarsduik", glyph: "golf", kleur: "#2f8fd8", periode: "tussen 1 en 3 januari",
      puzzels: ["nieuwjaarsduik"], past: (iso) => tussen(md(iso), "01-01", "01-03") },
    { id: "halloween", naam: "Halloween", glyph: "pompoen", kleur: "#f07a1a", periode: "tussen 28 oktober en 1 november",
      puzzels: ["trick-or-treat"], past: (iso) => tussen(md(iso), "10-28", "11-01") },
    { id: "carnaval", naam: "Carnaval", glyph: "masker", kleur: "#b93fb0", periode: "van zondag tot en met dinsdag van carnaval",
      puzzels: ["carnaval"], past: (iso) => { const p = pasen(+iso.slice(0, 4)); return tussen(iso, plus(p, -49), plus(p, -47)); } },
    { id: "janjarig", naam: "Jan is jarig", glyph: "taart", kleur: "#ff5d8f", periode: "rond 24 februari, de verjaardag van Jan van Haasteren (21 tot en met 27 februari)",
      puzzels: ["fijne-verjaardag-jan", "hoera-jan-90-jaar"], past: (iso) => tussen(md(iso), "02-21", "02-27") },
    { id: "dierendag", naam: "Dierendag", glyph: "poot", kleur: "#8b6b3d", periode: "rond dierendag (2 tot en met 6 oktober)",
      puzzels: ["de-dierentuin", "de-kinderboerderij"], past: (iso) => tussen(md(iso), "10-02", "10-06") },
    { id: "pride", naam: "Celebrate Pride", glyph: "regenboog", kleur: "regenboog", periode: "in de Pride-week (25 juni tot en met 1 juli) of rond de Canal Parade (de eerste zaterdag van augustus, een dag eerder of later mag ook)",
      puzzels: ["celebrate-pride"], past: (iso) => { const z = nde(+iso.slice(0, 4), 8, 6, 1); return tussen(md(iso), "06-25", "07-01") || tussen(iso, plus(z, -1), plus(z, 1)); } },
    { id: "muertos", naam: "Día de los Muertos", glyph: "schedel", kleur: "#e84a8a", periode: "tussen 31 oktober en 2 november",
      puzzels: ["dia-de-los-muertos"], past: (iso) => tussen(md(iso), "10-31", "11-02") },
    { id: "songfestival", naam: "Songfestival", glyph: "microfoon", kleur: "#3b5bdb", periode: "in de week van de finale van het Songfestival (vier dagen ervoor tot een dag erna)",
      puzzels: ["eurosong-contest"], past: (iso) => { const f = SONGFESTIVAL[iso.slice(0, 4)]; return f ? tussen(iso, plus(f, -4), plus(f, 1)) : tussen(md(iso), "05-09", "05-23"); } },
    { id: "oktoberfest", naam: "Oktoberfest", glyph: "bierpul", kleur: "#3f86cf", periode: "tijdens het Oktoberfest (de eerste zaterdag na 15 september tot en met de eerste zondag van oktober)",
      puzzels: ["duits-bierfeest"],
      past: (iso) => {
        const j = +iso.slice(0, 4), vijftien = new Date(Date.UTC(j, 8, 15)).getUTCDay();
        const van = plus(isoVan(j, 9, 15), (6 - vijftien + 7) % 7 || 7);
        let tot = nde(j, 10, 0, 1);
        if (tot < isoVan(j, 10, 3)) tot = isoVan(j, 10, 3);
        return tussen(iso, van, tot);
      } },
    { id: "vierdaagse", naam: "Vierdaagse", glyph: "schoen", kleur: "#e05a2b", periode: "in de week van de Nijmeegse Vierdaagse (de zaterdag ervoor tot en met de vrijdag)",
      puzzels: ["nijmeegse-vierdaagse", "nijmegen-100-jaar-gaststad-van-de-4daagse"],
      past: (iso) => { const z = plus(nde(+iso.slice(0, 4), 7, 2, 3), -3); return tussen(iso, z, plus(z, 6)); } },
    { id: "tour", naam: "Tour de France", glyph: "fiets", kleur: "#f2c200", inkt: "#3a2c00", periode: "terwijl de Tour de France gereden wordt",
      puzzels: ["tour-de-france", "tour-de-france-1-van-3", "tour-de-france-2-van-3", "tour-de-france-3-van-3"],
      past: (iso) => { const t = TOUR[iso.slice(0, 4)] || ["07-01", "07-31"]; return tussen(md(iso), t[0], t[1]); } },
    { id: "corso", naam: "Bloemencorso", glyph: "bloem", kleur: "#e8577a", periode: "rond het corso van Zundert (de eerste zondag van september, drie dagen eerder of later mag ook)",
      puzzels: ["de-bloemencorso"], past: (iso) => { const z = nde(+iso.slice(0, 4), 9, 0, 1); return tussen(iso, plus(z, -3), plus(z, 3)); } },
  ];
  for (const f of FEEST) f.zelfde = new Set(f.puzzels);
  const feestVan = (l) => (l.datum && l.e && l.e.afbeelding ? FEEST.filter((f) => f.zelfde.has(l.e.afbeelding) && f.past(l.datum)) : []);

  // ---------------------------------------------------------------- the badges with ranks
  // maak(ctx) gives a function that takes the next log and returns the badge's number after it.
  // minder: a best time, a rank is reached below its threshold. nu(ctx): not from the logs in order, but as it is now.

  const telt = (als) => () => { let n = 0; return (l) => (als(l) ? ++n : n); };
  const verschillend = (sleutels) => () => { const s = new Set(); return (l) => { for (const k of [].concat(sleutels(l))) if (k != null) s.add(k); return s.size; }; };
  const besteTijd = (als) => () => { let b = Infinity; return (l) => { if (l.sec != null && als(l) && l.sec < b) b = l.sec; return b; }; };
  const solo = (l) => l.makers.length === 1;

  // a run of days (or weeks) one after the other; the logs come in date order
  function reeks() {
    return () => {
      let laatst = null, nu = 0, langste = 0;
      return (n) => {
        if (n == null || n === laatst) return langste;
        nu = laatst != null && n === laatst + 1 ? nu + 1 : 1;
        laatst = n;
        langste = Math.max(langste, nu);
        return langste;
      };
    };
  }

  const RANG = [
    { id: "puzzelaar", naam: "Puzzelaar", glyph: "stukje", uitleg: "Leg puzzels, hoe groot of klein ook.",
      grenzen: [10, 50, 150, 300, 600], tekst: telwoord("puzzel", "puzzels"), maak: telt(() => true) },
    { id: "stukjes", naam: "Stukjesvreter", glyph: "koekje", uitleg: "Tel alle stukjes die je gelegd hebt bij elkaar op.",
      grenzen: [10000, 50000, 150000, 300000, 600000], tekst: telwoord("stukje", "stukjes"),
      maak: () => { let n = 0; return (l) => (n += l.gelegd); } },
    { id: "solist", naam: "Solist", glyph: "persoon", uitleg: "Leg puzzels helemaal alleen.",
      grenzen: [5, 15, 40, 100, 200], tekst: telwoord("puzzel solo", "puzzels solo"), maak: telt(solo) },
    { id: "onderuur", naam: "Onder het uur", glyph: "stopwatch", uitleg: "Leg een puzzel van 1000 stukjes in minder dan een uur, met hoeveel mensen ook.",
      grenzen: [1, 5, 15, 30, 50], tekst: telwoord("keer", "keer"), maak: telt((l) => l.stukjes === 1000 && l.sec != null && l.sec < 3600) },
    { id: "snel500", naam: "Snelle 500", glyph: "t500", uitleg: "Leg een puzzel van 500 stukjes in je eentje, zo snel mogelijk (expertpuzzels tellen niet mee).",
      grenzen: [u(2), u(1, 30), u(1, 15), u(1), u(0, 50)], minder: true, maak: besteTijd((l) => solo(l) && l.stukjes === 500 && !l.expert) },
    { id: "snel1000", naam: "Snelle 1000", glyph: "t1000", uitleg: "Leg een puzzel van 1000 stukjes in je eentje, zo snel mogelijk.",
      grenzen: [u(4), u(3), u(2, 30), u(2), u(1, 45)], minder: true, maak: besteTijd((l) => solo(l) && l.stukjes === 1000) },
    { id: "snelduo", naam: "Snel duo", glyph: "duoSnel", uitleg: "Leg een puzzel van 1000 stukjes met z'n tweeën, zo snel mogelijk.",
      grenzen: [u(2, 30), u(2), u(1, 30), u(1, 15), u(1, 5)], minder: true, maak: besteTijd((l) => l.makers.length === 2 && l.stukjes === 1000) },
    { id: "snelteam", naam: "Snel team", glyph: "teamSnel", uitleg: "Leg een puzzel van 1000 stukjes met z'n vieren, zo snel mogelijk.",
      grenzen: [u(1, 30), u(1, 15), u(1), u(0, 50), u(0, 40)], minder: true, maak: besteTijd((l) => l.makers.length === 4 && l.stukjes === 1000) },
    { id: "xxl", naam: "XXL", glyph: "berg", uitleg: "Leg puzzels van 2000 stukjes of meer.",
      grenzen: [1, 3, 10, 25, 50], tekst: telwoord("XXL-puzzel", "XXL-puzzels"), maak: telt((l) => l.stukjes >= 2000) },
    { id: "marathon", naam: "Marathon", glyph: "zandloper", uitleg: "Puzzel 3 uur of langer aan één puzzel.",
      grenzen: [1, 3, 10, 20, 40], tekst: telwoord("marathon", "marathons"), maak: telt((l) => l.sec != null && l.sec >= u(3)) },
    { id: "kleintjes", naam: "Kleintjes", glyph: "klein3", uitleg: "Leg puzzels van 150 stukjes of minder.",
      grenzen: [3, 10, 25, 50, 100], tekst: telwoord("kleintje", "kleintjes"), maak: telt((l) => l.stukjes > 0 && l.stukjes <= 150) },
    { id: "dagreeks", naam: "Dagreeks", glyph: "vlam", uitleg: "Puzzel een paar dagen achter elkaar, elke dag minstens één puzzel.",
      grenzen: [2, 4, 7, 14, 30], tekst: telwoord("dag op rij", "dagen op rij"),
      maak: () => { const f = reeks()(); return (l) => f(l.datum ? R.dagNr(l.datum) : null); } },
    { id: "weekreeks", naam: "Weekreeks", glyph: "weekVlam", uitleg: `Leg weken achter elkaar minstens ${getal(1000)} stukjes per week (maandag tot en met zondag).`,
      grenzen: [2, 4, 8, 16, 26], tekst: telwoord("week op rij", "weken op rij"),
      maak: () => {
        const f = reeks()(), perWeek = new Map();
        return (l) => {
          if (!l.datum) return f(null);
          const w = R.weekNr(l.datum), voor = perWeek.get(w) || 0;
          perWeek.set(w, voor + l.gelegd);
          return f(voor < R.WEEK_STUKJES && voor + l.gelegd >= R.WEEK_STUKJES ? w : null);
        };
      } },
    { id: "puzzeldag", naam: "Puzzeldag", glyph: "dagen3", uitleg: "Leg zoveel mogelijk puzzels op één dag.",
      grenzen: [2, 3, 5, 8, 12], tekst: telwoord("puzzel op één dag", "puzzels op één dag"),
      maak: () => { const n = new Map(); let max = 0; return (l) => { if (l.datum) { n.set(l.datum, (n.get(l.datum) || 0) + 1); max = Math.max(max, n.get(l.datum)); } return max; }; } },
    { id: "weekend", naam: "Weekendpuzzelaar", glyph: "zon", uitleg: "Puzzel op zaterdag of zondag.",
      grenzen: [5, 20, 50, 100, 200], tekst: telwoord("puzzel in het weekend", "puzzels in het weekend"),
      maak: telt((l) => l.datum && (dag(l.datum) === 0 || dag(l.datum) === 6)) },
    { id: "teamspeler", naam: "Teamspeler", glyph: "duo", uitleg: "Puzzel met zoveel mogelijk verschillende mensen.",
      grenzen: [3, 6, 12, 20, 30], tekst: telwoord("puzzelpartner", "puzzelpartners"),
      maak: (ctx) => verschillend((l) => l.makers.filter((m) => m !== ctx.wie))() },
    { id: "grotegroep", naam: "Grote groep", glyph: "vijf", uitleg: "Leg een puzzel met 5 mensen of meer.",
      grenzen: [1, 3, 5, 10, 20], tekst: telwoord("keer", "keer"), maak: telt((l) => l.makers.length >= 5) },
    { id: "verbeteraar", naam: "Verbeteraar", glyph: "pijl", uitleg: "Leg een puzzel opnieuw met precies dezelfde mensen (of weer alleen), minstens 10 minuten sneller dan de eerste keer. Elke puzzel telt één keer.",
      grenzen: [1, 3, 8, 15, 30], tekst: telwoord("puzzel", "puzzels"),
      maak: () => {
        const eerste = new Map(), beter = new Set();
        return (l) => {
          if (l.sec == null || !l.stukjes) return beter.size;
          const k = `${l.versie}#${l.team}`;
          if (!eerste.has(k)) eerste.set(k, l.sec);
          else if (l.sec <= eerste.get(k) - 600) beter.add(k);
          return beter.size;
        };
      } },
    { id: "trouw", naam: "Trouwe fan", glyph: "hart", uitleg: "Leg dezelfde puzzel (zelfde plaat, zelfde aantal stukjes) vaker.",
      grenzen: [2, 3, 5, 8, 12], tekst: telwoord("keer dezelfde", "keer dezelfde"),
      maak: () => { const n = new Map(); let max = 0; return (l) => { if (l.stukjes) { n.set(l.versie, (n.get(l.versie) || 0) + 1); max = Math.max(max, n.get(l.versie)); } return max; }; } },
    { id: "ontdekker", naam: "Ontdekker", glyph: "kompas", uitleg: "Leg zoveel mogelijk verschillende platen.",
      grenzen: [10, 50, 100, 200, 350], tekst: telwoord("plaat", "platen"), maak: verschillend((l) => l.e && l.e.afbeelding) },
    { id: "alleskunner", naam: "Alleskunner", glyph: "vierkantjes", uitleg: "Leg puzzels met zoveel mogelijk verschillende aantallen stukjes (500 expert telt als een eigen formaat).",
      grenzen: [3, 5, 8, 12, 18], tekst: telwoord("formaat", "formaten"), maak: verschillend((l) => (l.stukjes ? l.maat : null)) },
    { id: "zwaar", naam: "Zware jongen", glyph: "halter", uitleg: "Leg de moeilijkste puzzels: die met 5 sterren.",
      grenzen: [1, 5, 15, 30, 60], tekst: telwoord("puzzel met 5 sterren", "puzzels met 5 sterren"), maak: telt((l) => l.a && l.a.rating === 5) },
    { id: "verzamelaar", naam: "Verzamelaar", glyph: "dozen", uitleg: "Heb zoveel mogelijk eigen dozen in de kast (dozen die weg zijn tellen niet).",
      grenzen: [5, 25, 75, 150, 300], tekst: telwoord("doos", "dozen"), nu: (ctx) => ctx.D.dozen.filter((e) => e.eigenaren.includes(ctx.wie)).length },
    { id: "filmster", naam: "Filmster", glyph: "klapper", uitleg: "Film jezelf terwijl je puzzelt.",
      grenzen: [1, 10, 25, 75, 150], tekst: telwoord("keer gefilmd", "keer gefilmd"), maak: telt((l) => l.gefilmd) },
    { id: "veteraan", naam: "Veteraan", glyph: "lauwer", uitleg: "Puzzel jaar na jaar: elk jaar waarin je een puzzel legde telt.",
      grenzen: [1, 3, 5, 8, 12], tekst: telwoord("jaar", "jaren"), maak: verschillend((l) => (l.datum ? l.datum.slice(0, 4) : null)) },
    { id: "nk", naam: "NK-niveau", glyph: "beker", uitleg: "Wees sneller dan de winnaar van het NK op dezelfde puzzel, met evenveel mensen als op het NK (solo, duo of team van 4).",
      grenzen: [1, 3, 6, 12, 25], tekst: telwoord("keer", "keer"),
      maak: (ctx) => telt((l) => l.sec != null && ctx.nk.has(`${l.e && l.e.afbeelding}|${l.stukjes}|${l.makers.length}`) && l.sec < ctx.nk.get(`${l.e.afbeelding}|${l.stukjes}|${l.makers.length}`))() },
    { id: "record", naam: "Recordhouder", glyph: "podium", uitleg: "Houd records op de records-muur: de snelste tijd op een aantal stukjes met even veel mensen. Alleen de records die nu van jou zijn tellen.",
      grenzen: [1, 3, 8, 15, 30], tekst: telwoord("record", "records"),
      nu: (ctx) => R.records(ctx.D).map((r) => r.log).filter((l) => l.makers.includes(ctx.wie)) },
    { id: "feestvierder", naam: "Feestvierder", glyph: "confetti", uitleg: "Haal verschillende feestdagbadges.",
      grenzen: [1, 3, 6, 10, 15], tekst: telwoord("feestdagbadge", "feestdagbadges"), maak: verschillend((l) => feestVan(l).map((f) => f.id)) },
  ];

  // one level only, always diamond
  const SPECIAAL = [
    { id: "bliksem", naam: "Bliksem", glyph: "bliksem", uitleg: "Leg een puzzel van 500 stukjes (geen expertpuzzel) in je eentje binnen 40 minuten.",
      grenzen: [1], speciaal: true, tekst: telwoord("keer", "keer"), maak: telt((l) => solo(l) && l.stukjes === 500 && !l.expert && l.sec != null && l.sec < u(0, 40)) },
    // the oldest puzzle with a date (as "Puzzelt mee sinds" on the person page); only without any date the first log
    { id: "eerste", naam: "Eerste stukje", glyph: "stukjeSter", uitleg: "Je eerste puzzel bij Puzzullu: de oudste die we met datum kennen.",
      grenzen: [1], speciaal: true, geenStand: true, tekst: telwoord("puzzel", "puzzels"),
      maak: (ctx) => { const metDatum = ctx.eigen.some((l) => l.datum); let n = 0; return (l) => (n = Math.min(1, n + (!metDatum || l.datum ? 1 : 0))); } },
    { id: "seconde", naam: "Op de seconde", glyph: "roos", uitleg: "Leg een puzzel opnieuw met precies dezelfde mensen (of weer alleen), en zit hooguit 10 seconden van de vorige tijd af.",
      grenzen: [1], speciaal: true, tekst: telwoord("keer", "keer"),
      maak: () => {
        const vorige = new Map();
        let n = 0;
        return (l) => {
          if (l.sec == null || !l.stukjes) return n;
          const k = `${l.versie}#${l.team}`;
          if (vorige.has(k) && Math.abs(l.sec - vorige.get(k)) <= 10) n += 1;
          vorige.set(k, l.sec);
          return n;
        };
      } },
  ];

  const FEESTBADGES = FEEST.map((f) => ({ ...f, feest: true, grenzen: [1], tekst: telwoord("keer", "keer"),
    maak: telt((l) => feestVan(l).includes(f)) }));

  // the explanation as HTML; for a holiday it names its puzzles (D from PZR.voorbereiden)
  function uitleg(b, D) {
    if (!b.feest) return esc(b.uitleg);
    const namen = [...new Set(b.puzzels.map((p) => (D.afb[p] ? R.naam(D.afb[p]) : p)))].map((n) => `<i>${esc(n)}</i>`);
    const lijst = namen.length > 1 ? `${namen.slice(0, -1).join(", ")} of ${namen[namen.length - 1]}` : namen[0];
    return `Leg ${lijst} ${esc(b.periode)}.`;
  }

  const ALLE = [...RANG, ...SPECIAAL, ...FEESTBADGES];

  // ---------------------------------------------------------------- per person

  const opVolgorde = (logs) => [...logs].sort((x, y) => (x.datum || "").localeCompare(y.datum || "") || x.id.localeCompare(y.id));
  const haalt = (b, waarde, grens) => (b.minder ? waarde < grens : waarde >= grens);

  // the NK winners' times: picture|pieces|people → the slowest winner, so "faster than a winner" counts once per log
  function nkTijden(D) {
    const GROOT = { solo: 1, duo: 2, team: 4 }, m = new Map();
    for (const n of D.nk || []) {
      if (!n.afbeelding || !n.stukjes || !GROOT[n.categorie] || n.sec == null) continue;
      const k = `${n.afbeelding}|${n.stukjes}|${GROOT[n.categorie]}`;
      m.set(k, Math.max(m.get(k) || 0, n.sec));
    }
    return m;
  }

  // D from PZR.voorbereiden; gives every badge with its number, rank (0 = not yet) and the log of each rank reached
  function van(D, wie, ctx0) {
    const eigen = opVolgorde(D.logs.filter((l) => l.makers.includes(wie)));
    const ctx = { D, wie, eigen, nk: (ctx0 && ctx0.nk) || nkTijden(D) };
    return ALLE.map((b) => {
      const behaald = [];
      let waarde = b.minder ? Infinity : 0;
      if (b.nu) {
        const nu = b.nu(ctx);
        if (Array.isArray(nu)) {
          waarde = nu.length;
          opVolgorde(nu).forEach((l, i) => { if (behaald.length < b.grenzen.length && haalt(b, i + 1, b.grenzen[behaald.length])) behaald.push(l); });
        } else {
          waarde = nu;
          while (behaald.length < b.grenzen.length && haalt(b, waarde, b.grenzen[behaald.length])) behaald.push(null);
        }
      } else {
        const stap = b.maak(ctx);
        for (const l of eigen) {
          waarde = stap(l);
          while (behaald.length < b.grenzen.length && haalt(b, waarde, b.grenzen[behaald.length])) behaald.push(l);
        }
      }
      return { b, waarde, rang: behaald.length, behaald };
    });
  }

  // the ranks a new log brings, per maker: [{wie, nieuw: [{b, rang}]}]
  function nieuw(voor, na, makers) {
    const ctxV = { nk: nkTijden(voor) }, ctxN = { nk: nkTijden(na) };
    return makers.map((wie) => {
      const oud = new Map(van(voor, wie, ctxV).map((x) => [x.b.id, x.rang]));
      return { wie, nieuw: van(na, wie, ctxN).filter((x) => x.rang > (oud.get(x.b.id) || 0)) };
    }).filter((x) => x.nieuw.length);
  }

  // the rank's name: Hout … Diamant; special and holiday badges have one level
  const rangNaam = (b, rang) => (!rang ? "Nog niet behaald" : b.feest ? "Feestdag" : b.speciaal ? "Speciaal" : RANGEN[rang - 1]);
  const waardeTekst = (b, w) => (b.minder ? (w === Infinity ? "nog geen tijd" : tijd(w)) : b.tekst(w));
  const grensTekst = (b, g) => (b.minder ? `onder ${tijd(g)}` : b.tekst(g));

  // how far to the next rank, 0..1
  function voortgang(x) {
    const { b, waarde, rang } = x;
    if (rang >= b.grenzen.length) return 1;
    const g = b.grenzen[rang];
    if (b.minder) {
      if (waarde === Infinity) return 0;
      const van = rang ? b.grenzen[rang - 1] : g * 2;
      return Math.max(0, Math.min(1, (van - waarde) / (van - g)));
    }
    const van = rang ? b.grenzen[rang - 1] : 0;
    return Math.max(0, Math.min(1, (waarde - van) / (g - van)));
  }

  // ---------------------------------------------------------------- pictures

  const STUK = "M100,100H184V90A26,26 0 1 1 216,90V100H300V144H310A26,26 0 1 1 310,176H300V300H216V310A26,26 0 1 1 184,310V300H100V226H90A26,26 0 1 1 90,194H100Z";
  const VIEW = "38 38 324 324";

  const mens = (x, y, s = 1) => `<circle cx="${x}" cy="${y - 8 * s}" r="${6 * s}"/><path d="M${x - 11 * s},${y + 12 * s}A${11 * s},${11 * s} 0 0 1 ${x + 11 * s},${y + 12 * s}"/>`;
  const vlamPad = "M2,-24C6,-12 18,-6 17,7C16,18 8,23 0,23C-9,23 -17,17 -17,7C-17,-2 -10,-7 -8,-14C-4,-8 -2,-6 2,-24Z";
  const stukjePad = "M-18,-14H-6A7,7 0 1 1 6,-14H18V-4A7,7 0 1 1 18,8V20H-18Z";
  const flitsje = (x, y, s) => `<path class="v" transform="translate(${x} ${y}) scale(${s})" d="M6,-26L-14,4H-1L-6,26L14,-6H1Z"/>`;
  const rond = (n, r, f) => Array.from({ length: n }, (_, i) => f(Math.cos((i / n) * 2 * Math.PI - Math.PI / 2) * r, Math.sin((i / n) * 2 * Math.PI - Math.PI / 2) * r)).join("");
  const ster = (r1, r2) => `M${Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? r2 : r1, h = (i / 10) * 2 * Math.PI - Math.PI / 2; return `${(Math.cos(h) * r).toFixed(1)},${(Math.sin(h) * r).toFixed(1)}`; }).join("L")}Z`;

  const G = {
    stukje: `<path d="${stukjePad}"/>`,
    koekje: '<path d="M21,-8A22,22 0 1 1 8,-21A8,8 0 0 0 14,-13A8,8 0 0 0 21,-8Z"/><circle class="v" cx="-8" cy="-4" r="3.2"/><circle class="v" cx="6" cy="7" r="3.2"/><circle class="v" cx="-7" cy="10" r="3.2"/><circle class="v" cx="5" cy="-8" r="2.6"/>',
    persoon: mens(0, 2, 1.4),
    stopwatch: '<circle cx="0" cy="4" r="18"/><path d="M0,-14V-21M-6,-23H6M0,4L8,-5M14,-10L18,-14"/>',
    t500: '<path d="M-27,-9H-21M-29,0H-22M-27,9H-21"/><text class="t" x="5" y="7">500</text>',
    t1000: '<path d="M-28,-9H-24M-30,0H-25M-28,9H-24"/><text class="t" x="6" y="6" style="font-size:15px">1000</text>',
    duoSnel: mens(-10, 6, 0.95) + mens(10, 6, 0.95) + flitsje(19, -16, 0.42),
    teamSnel: [-18, -6, 6, 18].map((x) => mens(x, 8, 0.7)).join("") + flitsje(18, -17, 0.4),
    berg: '<path d="M-26,20L-6,-16L4,0L11,-9L26,20Z"/><path d="M-13,-3L-6,-16L1,-4"/>',
    zandloper: '<path d="M-13,-21H13M-13,21H13M-10,-21C-10,-6 10,6 10,21M10,-21C10,-6 -10,6 -10,21"/><path class="v" d="M-5,16L0,10L5,16Z"/>',
    klein3: [[-12, -11], [12, -5], [-6, 13]].map(([x, y]) => `<path stroke-width="9" transform="translate(${x} ${y}) scale(.48)" d="${stukjePad}"/>`).join(""),
    vlam: `<path d="${vlamPad}"/><path class="v" d="M0,19C-5,19 -7,15 -6,11C-5,7 -2,6 -1,2C3,6 6,9 5,13C4,17 3,19 0,19Z"/>`,
    weekVlam: `<rect x="-20" y="-16" width="40" height="36" rx="5"/><path d="M-20,-5H20M-10,-22V-12M10,-22V-12"/><path class="v" transform="translate(0 8) scale(.42)" d="${vlamPad}"/>`,
    dagen3: '<rect x="-18" y="-6" width="28" height="28" rx="4"/><path d="M-18,3H10M-12,-6V-12H16V16H10M-6,-12V-18H22V10H16"/>',
    zon: `<circle r="9"/><path d="${rond(8, 1, (x, y) => `M${(x * 15).toFixed(1)},${(y * 15).toFixed(1)}L${(x * 23).toFixed(1)},${(y * 23).toFixed(1)}`)}"/>`,
    duo: mens(-10, 4, 1) + mens(10, 4, 1),
    vijf: [-20, -10, 0, 10, 20].map((x, i) => mens(x, i % 2 ? 2 : 8, 0.62)).join(""),
    pijl: '<path d="M-24,18L-8,2L2,10L22,-12M9,-12H22V1"/>',
    hart: '<path d="M0,20C-30,0 -20,-26 0,-10C20,-26 30,0 0,20Z"/>',
    kompas: '<circle r="22"/><path class="v" d="M0,-15L5,0L0,15L-5,0Z"/>',
    vierkantjes: '<rect x="-24" y="8" width="10" height="10" rx="2"/><rect x="-10" y="4" width="14" height="14" rx="2"/><rect x="8" y="0" width="18" height="18" rx="2"/><path d="M-19,-6V-14M-3,-10V-20M17,-14V-24"/>',
    halter: '<path d="M-14,0H14M-18,-12V12M-24,-7V7M18,-12V12M24,-7V7"/>',
    dozen: '<rect x="-20" y="6" width="40" height="15" rx="2"/><rect x="-15" y="-9" width="30" height="15" rx="2"/><rect x="-10" y="-24" width="20" height="15" rx="2"/>',
    klapper: '<rect x="-21" y="-4" width="42" height="25" rx="3"/><path d="M-21,-4L-23,-13L18,-22L20,-13M-12,-15L-7,-6M0,-18L5,-9M10,-20L14,-11"/>',
    lauwer: `<path class="v" d="${ster(12, 5)}" transform="translate(0 -3)"/><path d="M-12,20C-24,14 -26,0 -20,-14M12,20C24,14 26,0 20,-14"/><path d="M-22,-4L-28,-8M-20,8L-27,7M22,-4L28,-8M20,8L27,7"/>`,
    beker: '<path d="M-14,-20H14V-6A14,14 0 0 1 -14,-6Z"/><path d="M-14,-16H-22V-10A8,8 0 0 0 -12,0M14,-16H22V-10A8,8 0 0 1 12,0M0,8V16M-10,20H10"/>',
    podium: '<path d="M-24,20V4H-8V-8H8V10H24V20Z"/><text class="t" x="0" y="6" style="font-size:13px">1</text>',
    confetti: '<path d="M-20,-18L-14,-12M8,-22L12,-16M18,-6L24,-8M-24,4L-18,6M-6,18L-2,24M14,14L20,20"/><circle class="v" cx="-4" cy="-10" r="3"/><circle class="v" cx="16" cy="4" r="3"/><circle class="v" cx="-14" cy="14" r="3"/><circle class="v" cx="4" cy="6" r="2.4"/><path class="v" d="M-2,-22L2,-26L4,-20Z"/>',
    bliksem: '<path class="v" d="M6,-26L-14,4H-1L-6,26L14,-6H1Z"/>',
    stukjeSter: `<path d="${stukjePad}" transform="translate(-3 4)"/><path class="v" transform="translate(-3 6)" d="${ster(9, 4)}"/>`,
    roos: '<circle r="22"/><circle r="13"/><circle class="v" r="4.5"/>',
    // holidays
    kerstboom: '<path d="M0,-24L-12,-6H-6L-18,12H18L6,-6H12Z"/><path d="M0,12V22"/>',
    kaars: '<rect x="-7" y="-4" width="14" height="26" rx="2"/><path class="v" d="M0,-24C5,-17 6,-13 0,-9C-6,-13 -5,-17 0,-24Z"/>',
    mijter: '<path d="M-14,22V-4C-14,-14 -6,-20 0,-26C6,-20 14,-14 14,-4V22Z"/><path d="M0,-14V6M-7,-6H7"/>',
    kroon: '<path d="M-22,12L-24,-12L-11,0L0,-18L11,0L24,-12L22,12Z"/><path d="M-22,20H22"/>',
    krans: `<circle r="17"/>${rond(8, 17, (x, y) => `<circle class="v" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/>`)}`,
    kat: '<path d="M-16,20C-22,8 -20,-4 -16,-10L-18,-24L-6,-14C-2,-15 2,-15 6,-14L18,-24L16,-10C20,-4 22,8 16,20Z"/><path class="v" d="M-10,0L-4,0L-7,4Z M10,0L4,0L7,4Z"/>',
    kaartje: '<path d="M-22,2L2,-22H22V-2L-2,22Z"/><circle cx="12" cy="-12" r="3.5"/>',
    vuurwerk: `<path d="${rond(8, 1, (x, y) => `M${(x * 7).toFixed(1)},${(y * 7 - 6).toFixed(1)}L${(x * 18).toFixed(1)},${(y * 18 - 6).toFixed(1)}`)}M0,24V16"/>${rond(8, 22, (x, y) => `<circle class="v" cx="${x.toFixed(1)}" cy="${(y - 6).toFixed(1)}" r="2"/>`)}`,
    golf: '<path d="M-24,-4C-16,-14 -8,-14 0,-4C8,6 16,6 24,-4M-24,12C-16,2 -8,2 0,12C8,22 16,22 24,12"/>',
    pompoen: '<ellipse cy="5" rx="22" ry="16"/><ellipse cy="5" rx="8" ry="16"/><path d="M0,-11C0,-17 4,-21 9,-22"/>',
    masker: '<path d="M-24,-8C-12,-14 12,-14 24,-8C24,6 14,12 6,8L0,2L-6,8C-14,12 -24,6 -24,-8Z"/><ellipse cx="-11" cy="-2" rx="5" ry="3.5"/><ellipse cx="11" cy="-2" rx="5" ry="3.5"/>',
    taart: '<rect x="-20" y="0" width="40" height="20" rx="3"/><path d="M-20,8C-14,12 -6,4 0,8C6,12 14,4 20,8M0,0V-10"/><path class="v" d="M0,-24C4,-19 5,-16 0,-13C-5,-16 -4,-19 0,-24Z"/>',
    poot: '<ellipse class="v" cx="0" cy="10" rx="11" ry="9"/><ellipse class="v" cx="-15" cy="-4" rx="5" ry="6"/><ellipse class="v" cx="15" cy="-4" rx="5" ry="6"/><ellipse class="v" cx="-6" cy="-16" rx="5" ry="6"/><ellipse class="v" cx="6" cy="-16" rx="5" ry="6"/>',
    regenboog: '<path d="M-25,16A25,25 0 0 1 25,16M-17,16A17,17 0 0 1 17,16M-9,16A9,9 0 0 1 9,16"/>',
    schedel: '<path d="M-16,6C-22,-18 22,-18 16,6V12H-16Z"/><circle class="v" cx="-7" cy="-1" r="4.5"/><circle class="v" cx="7" cy="-1" r="4.5"/><path d="M-8,12V20H8V12M0,12V20"/>' + rond(5, 4.5, (x, y) => `<circle class="v" cx="${(x + 15).toFixed(1)}" cy="${(y - 18).toFixed(1)}" r="2.6"/>`),
    microfoon: '<rect x="-8" y="-24" width="16" height="26" rx="8"/><path d="M-14,-4A14,14 0 0 0 14,-4M0,10V20M-8,20H8"/>',
    bierpul: '<rect x="-16" y="-12" width="24" height="33" rx="3"/><path d="M8,-5H14A6,6 0 0 1 20,1V6A6,6 0 0 1 14,12H8M-18,-12C-18,-22 -8,-23 -4,-18C0,-23 11,-22 10,-12M-8,-2V13M0,-2V13"/>',
    schoen: '<path d="M-20,-18H-6V-4L12,4C20,6 24,10 24,16V20H-20Z"/><path d="M-20,12H24M-6,-10H2M-6,-4H6"/>',
    fiets: '<circle cx="-14" cy="10" r="9"/><circle cx="14" cy="10" r="9"/><path d="M-14,10L-4,-8H10L14,10M-4,-8L2,10L10,-8M-9,-15H0M10,-8L8,-16H14"/>',
    bloem: `${rond(6, 11, (x, y) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>`)}<circle class="v" r="5"/>`,
  };

  const STIJL = {
    0: { inkt: "#5d75ab", rand: "#3d568f" },
    1: { inkt: "#3b220f", rand: "#4a2c14" },
    2: { inkt: "#45250a", rand: "#6b3d18" },
    3: { inkt: "#2c3644", rand: "#6d7787" },
    4: { inkt: "#573800", rand: "#9c6b06" },
    5: { inkt: "#0c4658", rand: "#3d9cbb" },
  };
  const NAAM = ["", "hout", "brons", "zilver", "goud", "diamant"];

  // the gradients, wood grain and diamond facets, once per page (badges refer to them by id)
  function defs() {
    if (document.getElementById("pzb-defs")) return;
    const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ""}/>`).join("")}</linearGradient>`;
    const regenboog = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"];
    const html = `<svg id="pzb-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
      ${lin("pzb-hout", [[0, "#c08a52"], [0.5, "#9a6534"], [1, "#7a4a22"]], 1, 1)}
      ${lin("pzb-brons", [[0, "#f0b67c"], [0.45, "#b8743a"], [0.7, "#8c5426"], [1, "#c98a4d"]], 1, 1)}
      ${lin("pzb-zilver", [[0, "#ffffff"], [0.45, "#c3cad4"], [0.7, "#8f99a8"], [1, "#dde2e9"]], 1, 1)}
      ${lin("pzb-goud", [[0, "#fff1a8"], [0.4, "#f2c230"], [0.7, "#c98d0c"], [1, "#ffd84d"]], 1, 1)}
      ${lin("pzb-diamant", [[0, "#e9fcff"], [0.35, "#9ae6f7"], [0.65, "#4fbfe0"], [1, "#d4f7ff"]], 1, 1)}
      ${lin("pzb-glans", [[0, "#fff", 0.55], [0.45, "#fff", 0.08], [0.46, "#fff", 0], [1, "#fff", 0]])}
      ${lin("pzb-regenboog", regenboog.map((c, i) => [i / 5, c]))}
      ${FEEST.filter((f) => f.kleur !== "regenboog").map((f) => lin(`pzb-f-${f.id}`, [[0, f.kleur], [1, f.kleur]])).join("")}
      <clipPath id="pzb-vorm"><path d="${STUK}"/></clipPath>
      <pattern id="pzb-nerf" width="400" height="60" patternUnits="userSpaceOnUse">
        <path d="M0,12C80,4 160,22 240,12S360,4 400,12M0,34C70,26 150,44 230,34S350,28 400,36M0,52C90,46 170,58 260,50S370,46 400,52" fill="none" stroke="#4a2a10" stroke-opacity=".35" stroke-width="3"/>
      </pattern>
    </defs></svg>`;
    document.body.insertAdjacentHTML("afterbegin", html);
  }

  // one badge as SVG; rang 0 = not reached yet (dark, dashed edge)
  function svg(b, rang, maat = 72) {
    defs();
    const aan = rang > 0;
    const stijl = b.feest && aan ? { inkt: b.inkt || "#fff", rand: "rgba(0,0,0,.35)" } : STIJL[b.speciaal && aan ? 5 : rang];
    const vul = !aan ? "#13254a" : b.feest ? (b.kleur === "regenboog" ? "url(#pzb-regenboog)" : `url(#pzb-f-${b.id})`) : `url(#pzb-${NAAM[b.speciaal ? 5 : rang]})`;
    const r = b.speciaal || b.feest ? 0 : rang;
    const extra = !aan ? ""
      : r === 1 ? `<rect x="38" y="38" width="324" height="324" fill="url(#pzb-nerf)" clip-path="url(#pzb-vorm)"/>`
        : (r === 5 || b.speciaal) ? `<g clip-path="url(#pzb-vorm)" fill="#fff"><path d="M100,100L200,180L300,100Z" fill-opacity=".35"/><path d="M100,100L200,180L100,300Z" fill-opacity=".12"/><path d="M300,100L200,180L300,300Z" fill-opacity=".22"/><path d="M100,300L200,180L300,300Z" fill-opacity=".05"/></g><path d="${STUK}" fill="url(#pzb-glans)"/>`
          : `<path d="${STUK}" fill="url(#pzb-glans)"/>`;
    const stippen = b.grenzen.length > 1
      ? b.grenzen.map((_, i) => `<circle cx="${160 + i * 20}" cy="280" r="7.5" fill="${i < rang ? stijl.inkt : "none"}" stroke="${stijl.inkt}" stroke-width="3.5"/>`).join("") : "";
    return `<svg class="badge-svg" viewBox="${VIEW}" width="${maat}" height="${maat}" aria-hidden="true" focusable="false">`
      + `<path d="${STUK}" fill="${vul}" stroke="${stijl.rand}" stroke-width="9" stroke-linejoin="round"${aan ? "" : ' stroke-dasharray="16 12"'}/>`
      + extra
      + `<g transform="translate(200 ${b.grenzen.length > 1 ? 184 : 200}) scale(2.9)" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" style="color:${stijl.inkt}">${G[b.glyph] || ""}</g>`
      + stippen + "</svg>";
  }

  window.PZB = { RANG, SPECIAAL, FEEST: FEESTBADGES, ALLE, RANGEN, van, nieuw, svg, rangNaam, waardeTekst, grensTekst, voortgang, feestVan, opVolgorde, uitleg };
})();
