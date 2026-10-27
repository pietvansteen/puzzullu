#!/usr/bin/env python3
"""
One-off migration from the old Sheet layout to the new tabs (SPEC §3.3).

  python3 tools/migratie.py

Reads Puzzel Collectie 2.0, Alle uitgaves JvH and Voorronde/finale tijden (from testdata/ when there,
else from the live Sheet) and the JvH catalogue (cached in migratie/ after the first download), links every
name to a JvH picture and writes to migratie/ (gitignored, it holds our names and times):

  rapport.html       what Piet checks: proposed links, name changes, odd values, people
  keuzes.csv         every link that is not certain, with a "keuze" column: empty = take the proposal,
                     an afbeelding_id = link to that picture, "nieuw" = a picture of its own.
                     Kept between runs, so fill it in and run the script again.
  afbeeldingen.csv, exemplaren.csv, logs.csv, personen.csv, nk-tijden.csv
                     the new tabs, ready to import in the Sheet once Piet has confirmed the report

Nothing is written to the Sheet.
"""

import csv
import difflib
import html
import pathlib
import re
import sys
from collections import Counter, defaultdict
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sync"))
import jvh  # noqa: E402
import sync  # noqa: E402

OUT = ROOT / "migratie"
TESTDATA = ROOT / "testdata"
TODAY = date.today().strftime("%d-%m-%Y")
FUZZY = 0.82  # SequenceMatcher ratio from which a name "looks like" a JvH title

esc = html.escape


# ---------------------------------------------------------------- input

def tab(name):
    path = TESTDATA / f"{name.lower()}.csv"
    if path.exists():
        return list(csv.reader(path.open(encoding="utf-8")))
    return list(csv.reader(sync.download(sync.GIDS[name]).splitlines()))


def catalogue():
    pages = {}
    for key, url in (("afbeeldingen", jvh.AFBEELDINGEN_URL), ("puzzels", jvh.PUZZELS_URL)):
        path = OUT / f"jvh-{key}.html"
        if not path.exists():
            path.write_text(jvh.download(url), encoding="utf-8")
        pages[key] = path.read_text(encoding="utf-8")
    return jvh.catalogue(pages["afbeeldingen"], pages["puzzels"])


def read_keuzes():
    path = OUT / "keuzes.csv"
    if not path.exists():
        return {}
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    return {(r["soort"], jvh.name_key(r["naam_en"]), jvh.name_key(r["naam_nl"])): r["keuze"].strip()
            for r in rows if r.get("keuze", "").strip()}


# ---------------------------------------------------------------- matching

ARTICLES = re.compile(r"^(?:in de|op de|in het|op het|de|het|een|the|a)\s+", re.I)


class Matcher:
    def __init__(self, afbeeldingen):
        self.by_id = {a["id"]: a for a in afbeeldingen}
        self.exact, self.all, self.loose = {}, defaultdict(list), {}
        for a in afbeeldingen:
            self.add(a)
            for name in (a["nl"], a["en"]):
                self.loose.setdefault(jvh.name_key(ARTICLES.sub("", name.strip())), a)

    def add(self, a):
        self.by_id[a["id"]] = a
        for name in (a["nl"], a["en"]):
            k = jvh.name_key(name)
            self.exact.setdefault(k, a)
            if a not in self.all[k]:
                self.all[k].append(a)  # some names are used for more than one picture (Verkeerschaos)

    def match(self, en, nl):
        """(how, picture, alternatives): how is exact / conflict / lijkt / nieuw."""
        per_name = [self.all.get(jvh.name_key(n), []) for n in (en, nl) if n.strip()]
        per_name = [h for h in per_name if h]
        if len(per_name) == 2:
            both = [a for a in per_name[0] if a in per_name[1]]
            if both:
                return "exact", both[0], []
        hits = [h[0] for h in per_name]
        if hits:
            if len({h["id"] for h in hits}) > 1:
                return "conflict", hits[0], hits[1:]
            return "exact", hits[0], []
        hits = [self.loose.get(jvh.name_key(ARTICLES.sub("", n.strip()))) for n in (en, nl) if n.strip()]
        hits = [h for h in hits if h]
        if hits:
            return "lijkt", hits[0], []
        scored = {}
        for n in (en, nl):
            k = jvh.name_key(n)
            if not k:
                continue
            for other, a in self.exact.items():
                r = difflib.SequenceMatcher(None, k, other).ratio()
                if r > scored.get(a["id"], (0,))[0]:
                    scored[a["id"]] = (r, a)
        best = sorted(scored.values(), key=lambda x: -x[0])[:3]
        if best and best[0][0] >= FUZZY:
            return "lijkt", best[0][1], [a for _, a in best[1:]]
        return "nieuw", None, [a for r, a in best if r >= 0.6]


# ---------------------------------------------------------------- migration

def run():
    OUT.mkdir(exist_ok=True)
    cat = catalogue()
    afbeeldingen = [dict(a, rating=None, opmerking="") for a in cat["afbeeldingen"]]
    m = Matcher(afbeeldingen)
    keuzes = read_keuzes()
    links = {}            # (soort, en, nl) -> link info for keuzes.csv and the report
    renamed = []          # exact links whose spelling in the Sheet differs from JvH
    issues = defaultdict(list)

    def new_picture(en, nl, bron="handmatig"):
        base = jvh.slug(nl or en) or "puzzel"
        pid, n = base, 2
        while pid in m.by_id:
            pid, n = f"{base}-{n}", n + 1
        a = {"id": pid, "en": en.strip(), "nl": nl.strip(), "tekenaar": "", "jaar": None, "bron": bron,
             "jvhUrl": "", "versies": [], "rating": None, "opmerking": ""}
        afbeeldingen.append(a)
        m.add(a)
        return a

    def link(soort, en, nl, rows=1):
        key = (soort, jvh.name_key(en), jvh.name_key(nl))
        if key in links:
            links[key]["rijen"] += rows
            return links[key]["afbeelding"]
        how, a, alts = m.match(en, nl)
        choice = keuzes.get(key)
        if choice == "nieuw":
            how, a = "keuze", new_picture(en, nl)
        elif choice in m.by_id:
            how, a = "keuze", m.by_id[choice]
        elif choice:
            issues["keuzes"].append(f"Keuze “{choice}” voor {en or nl} bestaat niet; het voorstel is gebruikt.")
        if a is None:
            a = new_picture(en, nl)
        links[key] = {"soort": soort, "en": en.strip(), "nl": nl.strip(), "hoe": how, "afbeelding": a,
                      "alternatieven": alts, "keuze": choice or "", "rijen": rows}
        if how == "exact" and (en.strip() and en.strip() != a["en"] or nl.strip() and nl.strip() != a["nl"]):
            renamed.append((soort, en.strip(), nl.strip(), a))
        return a

    # --- Alle uitgaves JvH: rating and remark per picture
    rows = tab("UITGAVES")
    h = sync.header_row(rows, "titel nl")
    c = sync.columns(rows[h], nl=("titel nl",), en=("titel en",), opm=("opmerking",), rating=("rating",))
    for r in rows[h + 1:]:
        en, nl = sync.cell(r, c["en"]), sync.cell(r, c["nl"])
        if not (en or nl):
            continue
        a = link("uitgaves", en, nl)
        rating, opm = sync.number(sync.cell(r, c["rating"])), sync.cell(r, c["opm"])
        if rating:
            if a["rating"] and a["rating"] != rating:
                issues["rating"].append(f"{a['en']}: rating {a['rating']} en {rating} in Alle uitgaves JvH; {a['rating']} gebruikt.")
            a["rating"] = a["rating"] or rating
        if opm and opm not in a["opmerking"]:
            a["opmerking"] = f"{a['opmerking']}; {opm}" if a["opmerking"] else opm

    # --- Puzzel Collectie 2.0: boxes and logs
    rows = tab("COLLECTIE")
    c = sync.columns(rows[0], en=("naam puzzel engels",), nl=("naam puzzel nederlands",), stukjes=("aantal stukjes",),
                     eigenaar=("eigenaar",), compleet=("compleet",), tijd=("tijd",), datum=("datum",),
                     extra11=("column 11",), makers=("gemaakt door",), gefilmd=("gefilmd",), video=("url video",),
                     kolom1=("kolom 1",))
    exemplaren, logs, last = {}, [], {}
    for nr, r in enumerate(rows[1:], start=2):
        en, nl = sync.cell(r, c["en"]), sync.cell(r, c["nl"])
        if not (en or nl):
            continue
        a = link("collectie", en, nl)
        stukjes = sync.number(sync.cell(r, c["stukjes"]))
        eigenaar = sync.person(sync.cell(r, c["eigenaar"]))
        if eigenaar.lower() == "puzzullu":
            issues["eigenaar"].append(f"Rij {nr} ({en}): eigenaar Puzzullu → geen eigenaar.")
            eigenaar = ""
        key = (a["id"], stukjes, eigenaar)
        ex = exemplaren.get(key)
        if not ex:
            ex = exemplaren[key] = {"exemplaar_id": f"{a['id']}-{stukjes or 0}-{jvh.slug(eigenaar) or 'zonder'}",
                                    "afbeelding_id": a["id"], "stukjes": stukjes or "", "eigenaar": eigenaar,
                                    "volgnummer": 1, "missende_stukjes": 0, "status": "in bezit",
                                    "toegevoegd_op": TODAY, "gewijzigd_op": TODAY}
            if a["versies"] and stukjes not in a["versies"]:
                issues["stukjes"].append((a, stukjes, eigenaar, nr))
        if "verkocht" in sync.cell(r, c["kolom1"]).lower():
            ex["status"] = "weg"
            issues["weg"].append(f"Rij {nr}: {a['en']} {stukjes} van {eigenaar} is verkocht → status weg (de log blijft).")
        compleet, dag = sync.cell(r, c["compleet"]), sync.iso_date(sync.cell(r, c["datum"]))
        missend = sync.missing(compleet)
        if compleet.lower() == "nee":
            issues["compleet"].append(f"Rij {nr} ({a['en']} {stukjes}, {eigenaar}): “Nee” zonder aantal → 1 missend stukje.")
            missend = 1
        if compleet and (key not in last or (dag or "") >= last[key]):
            last[key] = dag or ""
            ex["missende_stukjes"] = missend or 0
        tijd, extra = sync.cell(r, c["tijd"]), sync.cell(r, c["extra11"])
        sec = sync.seconds(tijd)
        if extra:
            issues["kolom11"].append(f"Rij {nr} ({a['en']}, {sync.cell(r, c['datum'])}): “Column 11” = {extra}, "
                                     f"“Gemaakt door” = {sync.cell(r, c['makers'])}. Alleen “Gemaakt door” wordt overgenomen.")
        if tijd and sec is None:
            issues["tijd"].append(f"Rij {nr} ({a['en']}, {sync.cell(r, c['datum'])}): tijd “{tijd}” → gelegd zonder tijd.")
        if sec is None and dag:
            issues["zondertijd"].append(f"Rij {nr}: {a['en']} {stukjes} ({eigenaar}), {sync.cell(r, c['datum'])}, "
                                        f"{sync.cell(r, c['makers'])}")
        if sec is not None or dag:
            if sec is not None and not dag:
                issues["zonderdatum"].append(f"Rij {nr}: {a['en']} {stukjes} ({eigenaar}), {tijd}, {sync.cell(r, c['makers'])}")
            logs.append({"nr": nr, "ex": ex, "tijd": sync.cell(r, c["tijd"]) if sec is not None else "",
                         "datum": sync.cell(r, c["datum"]), "iso": dag or "", "makers": sync.makers(sync.cell(r, c["makers"])),
                         "compleet": "ja" if not missend else str(missend), "gefilmd": "ja" if sync.yes(sync.cell(r, c["gefilmd"])) else "nee",
                         "video_url": sync.cell(r, c["video"])})
    logs.sort(key=lambda l: (l["iso"] or "9999", l["nr"]))
    for i, l in enumerate(logs, start=1):
        l["log_id"] = f"L{i:04d}"

    # --- NK times
    rows = tab("NK")
    nk = []
    for r in rows[1:]:
        if not sync.cell(r, 0):
            continue
        a = link("nk", "", sync.cell(r, 0))
        nk.append(r[:5] + [a["id"]])

    # --- people
    makers = Counter(p for l in logs for p in l["makers"])
    owners = Counter(e["eigenaar"] for e in exemplaren.values() if e["eigenaar"])
    personen = sorted(set(makers) | set(owners), key=str.lower)

    write_tabs(afbeeldingen, exemplaren, logs, personen, nk, rows[0] if rows else [])
    write_keuzes(links)
    write_report(cat, afbeeldingen, links, renamed, issues, exemplaren, logs, makers, owners)


# ---------------------------------------------------------------- output

def write_csv(name, header, rows):
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def write_tabs(afbeeldingen, exemplaren, logs, personen, nk, nk_header):
    write_csv("afbeeldingen.csv", ["afbeelding_id", "titel_en", "titel_nl", "tekenaar", "jaar", "rating", "bron", "jvh_url", "opmerking"],
              [[a["id"], a["en"], a["nl"], a["tekenaar"], a["jaar"] or "", a["rating"] or "", a["bron"], a["jvhUrl"], a["opmerking"]]
               for a in sorted(afbeeldingen, key=lambda a: (a["en"] or a["nl"]).lower())])
    write_csv("exemplaren.csv", ["exemplaar_id", "afbeelding_id", "stukjes", "eigenaar", "volgnummer", "missende_stukjes",
                                 "status", "toegevoegd_op", "gewijzigd_op"],
              [[e[k] for k in ("exemplaar_id", "afbeelding_id", "stukjes", "eigenaar", "volgnummer", "missende_stukjes",
                               "status", "toegevoegd_op", "gewijzigd_op")]
               for e in sorted(exemplaren.values(), key=lambda e: e["exemplaar_id"])])
    write_csv("logs.csv", ["log_id", "exemplaar_id", "tijd", "datum", "makers", "compleet", "gefilmd", "video_url", "ingevoerd_op"],
              [[l["log_id"], l["ex"]["exemplaar_id"], l["tijd"], l["datum"], ", ".join(l["makers"]), l["compleet"],
                l["gefilmd"], l["video_url"], ""] for l in logs])
    write_csv("personen.csv", ["naam"], [[p] for p in personen])
    write_csv("nk-tijden.csv", [h.strip() for h in nk_header[:5]] + ["afbeelding_id"], nk)


def write_keuzes(links):
    rows = [l for l in links.values() if l["hoe"] != "exact"]
    rows.sort(key=lambda l: (l["soort"], l["hoe"], (l["en"] or l["nl"]).lower()))
    write_csv("keuzes.csv", ["soort", "naam_en", "naam_nl", "rijen", "hoe", "voorstel_id", "voorstel_en", "voorstel_nl",
                             "alternatieven", "keuze"],
              [[l["soort"], l["en"], l["nl"], l["rijen"], l["hoe"], l["afbeelding"]["id"], l["afbeelding"]["en"],
                l["afbeelding"]["nl"], " | ".join(a["id"] for a in l["alternatieven"]), l["keuze"]] for l in rows])


HOE = {"lijkt": "lijkt op", "nieuw": "eigen afbeelding", "conflict": "EN en NL wijzen naar iets anders", "keuze": "jouw keuze"}
SOORT = {"collectie": "Puzzel Collectie 2.0", "uitgaves": "Alle uitgaves JvH", "nk": "NK-tijden"}


def pic(a):
    title = f"{esc(a['en'])}<br><small>{esc(a['nl'])}</small>" if a["en"] != a["nl"] else esc(a["en"])
    link = f' <a href="{esc(a["jvhUrl"])}" target="_blank" rel="noopener">JvH</a>' if a["jvhUrl"] else ""
    return f"{title}<br><code>{esc(a['id'])}</code>{link}"


def write_report(cat, afbeeldingen, links, renamed, issues, exemplaren, logs, makers, owners):
    by_soort = defaultdict(list)
    for l in links.values():
        if l["hoe"] != "exact":
            by_soort[l["soort"]].append(l)

    def link_table(items):
        trs = []
        for l in sorted(items, key=lambda l: (l["hoe"], (l["en"] or l["nl"]).lower())):
            alts = "".join(f"<li>{pic(a)}</li>" for a in l["alternatieven"])
            sheet = f"{esc(l['en'])}<br><small>{esc(l['nl'])}</small>" if l["en"] and l["en"] != l["nl"] else esc(l["en"] or l["nl"])
            trs.append(f"<tr class='{l['hoe']}'><td>{sheet}<br><small>{l['rijen']} rij(en)</small></td>"
                       f"<td><span class='tag {l['hoe']}'>{HOE[l['hoe']]}</span></td><td>{pic(l['afbeelding'])}</td>"
                       f"<td>{'<ul>' + alts + '</ul>' if alts else ''}</td></tr>")
        return ("<table><tr><th>In de Sheet</th><th>Hoe</th><th>Voorstel</th><th>Andere mogelijkheden</th></tr>"
                + "".join(trs) + "</table>")

    sections = []
    n_ex = len(exemplaren)
    in_bezit = sum(1 for e in exemplaren.values() if e["eigenaar"] and e["status"] == "in bezit")
    eigen = [a for a in afbeeldingen if a["bron"] == "handmatig"]
    sections.append(f"""
      <h2>Samenvatting</h2>
      <ul>
        <li>JvH-catalogus: {len(cat['afbeeldingen'])} afbeeldingen ({sum(1 for a in cat['afbeeldingen'] if a['bron'] == 'jvh-puzzels')} daarvan alleen in de lijst met alle puzzels, zoals <i>In de drukte!</i>), {cat['puzzels']} uitgaves, {cat['combi']} combidozen overgeslagen.</li>
        <li>Nieuw tabblad <b>Afbeeldingen</b>: {len(afbeeldingen)} rijen, waarvan {len(eigen)} eigen afbeeldingen die JvH niet kent (bron <code>handmatig</code>) en {sum(1 for a in afbeeldingen if a['rating'])} met een rating.</li>
        <li><b>Exemplaren</b>: {n_ex} dozen, waarvan {in_bezit} in bezit. <b>Logs</b>: {len(logs)} keer gelegd, waarvan {sum(1 for l in logs if not l['tijd'])} zonder tijd.</li>
        <li>Te controleren koppelingen: {sum(len(v) for v in by_soort.values())}. Namen die anders geschreven worden dan bij JvH: {len(renamed)}.</li>
      </ul>
      <p class="hint">Iets anders kiezen? Zeg het in de chat, of vul in <code>migratie/keuzes.csv</code> de kolom <b>keuze</b> in
      (een <code>afbeelding_id</code>, of <code>nieuw</code> voor een eigen afbeelding) en draai <code>python3 tools/migratie.py</code> opnieuw.
      Er wordt niets in de Sheet geschreven tot je het rapport hebt goedgekeurd.</p>""")

    for soort in ("collectie", "nk", "uitgaves"):
        items = by_soort.get(soort)
        if items:
            intro = {"collectie": "Namen uit de collectie die niet letterlijk (los van hoofdletters, spaties en leestekens) in de JvH-lijsten staan.",
                     "nk": "Puzzels uit de NK-tijden. Die namen wijken vaak af (“In de speeltuin” ↔ “De Speeltuin”).",
                     "uitgaves": "Rijen uit Alle uitgaves JvH die niet letterlijk bij JvH staan. Hun rating en opmerking gaan mee naar de gekozen afbeelding."}[soort]
            sections.append(f"<h2>Koppelingen: {SOORT[soort]} ({len(items)})</h2><p>{intro}</p>{link_table(items)}")

    if renamed:
        rows = "".join(f"<tr><td>{SOORT[s]}</td><td>{esc(en)}<br><small>{esc(nl)}</small></td><td>{esc(a['en'])}<br><small>{esc(a['nl'])}</small></td></tr>"
                       for s, en, nl, a in sorted(renamed, key=lambda x: x[1].lower()))
        sections.append(f"""<h2>Naamwijzigingen ({len(renamed)})</h2>
          <p>Deze namen zijn zeker gekoppeld, maar worden op de site en in de nieuwe tabbladen geschreven zoals JvH ze schrijft.
          Vaak gaat het om hoofdletters of een spatie aan het eind.</p>
          <details><summary>Toon alle {len(renamed)}</summary><table><tr><th>Bron</th><th>Nu in de Sheet</th><th>Wordt (JvH)</th></tr>{rows}</table></details>""")

    if issues["stukjes"]:
        rows = "".join(f"<tr><td>{esc(a['en'])}</td><td>{s}</td><td>{esc(o) or '–'}</td><td>{', '.join(map(str, a['versies']))}</td><td>{nr}</td></tr>"
                       for a, s, o, nr in sorted(issues["stukjes"], key=lambda x: x[0]["en"].lower()))
        sections.append(f"""<h2>Aantal stukjes dat JvH niet kent ({len(issues['stukjes'])})</h2>
          <p>Dit hoeft niet fout te zijn (de JvH-lijst is niet compleet), maar soms is het een typfout of de verkeerde puzzel.</p>
          <table><tr><th>Puzzel</th><th>Stukjes</th><th>Eigenaar</th><th>Versies bij JvH</th><th>Eerste rij</th></tr>{rows}</table>""")

    people = "".join(f"<tr><td>{esc(p)}</td><td>{makers.get(p, 0)}</td><td>{owners.get(p, 0)}</td></tr>"
                     for p in sorted(set(makers) | set(owners), key=lambda p: (-makers.get(p, 0), p.lower())))
    sections.append(f"""<h2>Personen ({len(set(makers) | set(owners))})</h2>
      <p>Zoals ze in de Sheet staan (hoofdletter aan het begin, spaties weg). Klopt elke naam, en zijn er namen die dezelfde persoon zijn?
      Let op namen als <i>GJF</i>, <i>Pass-Out</i> en <i>Anne (a Campo)</i>.</p>
      <table><tr><th>Naam</th><th>Keer gelegd</th><th>Dozen</th></tr>{people}</table>""")

    other = [("tijd", "Tijden die geen tijd zijn"), ("zondertijd", "Gelegd zonder tijd (worden logs zonder tijd)"),
             ("zonderdatum", "Logs zonder datum"), ("kolom11", "Namen in de kolom “Column 11”"),
             ("compleet", "Niet compleet zonder aantal"), ("weg", "Verkocht"), ("eigenaar", "Eigenaar Puzzullu"),
             ("rating", "Verschillende ratings"), ("keuzes", "Keuzes die niet bestaan")]
    for key, title in other:
        if issues[key]:
            sections.append(f"<h2>{title} ({len(issues[key])})</h2><ul>{''.join(f'<li>{esc(x)}</li>' for x in issues[key])}</ul>")

    sections.append("""<h2>Niet automatisch te bepalen</h2>
      <p>Dubbel bezit van dezelfde versie (twee dozen van dezelfde puzzel en hetzelfde aantal stukjes bij één eigenaar) is niet uit de
      oude Sheet af te leiden: die rijen worden één exemplaar. Weet je zo’n geval, zeg het dan; dan krijgt het tweede exemplaar volgnummer 2.</p>""")

    page = f"""<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Migratierapport Puzzullu</title><style>
body {{ margin: 0; background: #0f1f3f; color: #fbf6ea; font: 15px/1.5 system-ui, sans-serif; }}
main {{ max-width: 1000px; margin: 0 auto; padding: 16px; }}
h1, h2 {{ font-family: "Arial Rounded MT Bold", system-ui, sans-serif; }} h2 {{ margin-top: 2em; }}
a {{ color: #ffc845; }} small, .hint {{ color: #a9b5cf; }} code {{ color: #ffe39a; }}
table {{ width: 100%; border-collapse: collapse; margin: 8px 0; }} th, td {{ text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #2a4274; }}
th {{ color: #a9b5cf; font-weight: 600; }} ul ul, td ul {{ margin: 0; padding-left: 1.1em; }}
.tag {{ display: inline-block; border-radius: 999px; padding: 0 8px; font-size: 13px; background: #2a4274; white-space: nowrap; }}
.tag.nieuw {{ background: #7a3b12; }} .tag.conflict {{ background: #7a1230; }} .tag.keuze {{ background: #1d6a3a; }}
details summary {{ cursor: pointer; color: #ffc845; }}
</style></head><body><main><h1>Migratierapport</h1><p class="hint">Gemaakt op {TODAY} door <code>tools/migratie.py</code>.</p>
{''.join(sections)}</main></body></html>"""
    (OUT / "rapport.html").write_text(page, encoding="utf-8")
    print(f"migratie/rapport.html: {len(afbeeldingen)} afbeeldingen, {len(exemplaren)} exemplaren, {len(logs)} logs, "
          f"{sum(len(v) for v in by_soort.values())} koppelingen te controleren, {len(renamed)} naamwijzigingen")


if __name__ == "__main__":
    run()
