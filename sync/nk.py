"""
NK times from nklegpuzzelen.nl: the winning time of every past NK event, for the NK-tijden tab.

The agenda (agenda-inschrijven) lists "Afgelopen evenementen", each with a date and a link to its page. An event page
with a result ("Uitslag") has:
  - a heading such as "Voorronde Teams", "Voorronde Duo", "Finale Solo": the round and the category;
  - the result table: place, team name, time; place 1 is the winning time;
  - "Gemaakte puzzel": a picture whose file name ends in "-<slug>-artwork.jpg" and a sentence like
    "... de Jan van Haasteren puzzel 'Hockey Kampioenschappen' gemaakt ... Deze puzzel van 1000 stukjes ...".
Every day of a voorronde is a different puzzle, and the same puzzle is often done at several places. The tab has one
row per puzzle, year, category and round, with the fastest winning time of those events.

rijen() returns those rows; nieuw() leaves out the ones the tab already has. Standard library only. Used by sync.py.
"""

import html
import re
import time
import urllib.parse
import urllib.request

BASE = "https://www.nklegpuzzelen.nl/"
AGENDA_URL = BASE + "agenda-inschrijven"
USER_AGENT = "puzzullu-sync/1.0 (+https://puzzullu.funkyorbit.nl; NK results check)"
CATEGORIE = {"teams": "Team", "team": "Team", "duo": "Duo", "duo's": "Duo", "solo": "Solo"}


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", "replace")


def tekst(s):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", s)).split())


def evenementen(agenda_html):
    """The past events of the agenda: [{"url", "datum" (YYYY-MM-DD), "label" (Teams, Duo, Solo, ...), "titel"}],
    newest first."""
    i = agenda_html.find("Afgelopen evenementen")
    if i < 0:
        raise RuntimeError("NK agenda: no 'Afgelopen evenementen' found")
    uit = []
    for blok in re.split(r'<div class="event ', agenda_html[i:])[1:]:
        href = re.search(r'href="([^"]*evenement/[^"]+)"', blok)
        dag = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', blok)
        label = re.search(r'class="event-label[^"]*">(.*?)</div>', blok, re.S)
        titel = re.search(r'<div class="title">(.*?)</div>', blok, re.S)
        if href and dag:
            url = href.group(1) if href.group(1).startswith("http") else BASE + href.group(1).lstrip("/")
            uit.append({"url": url, "datum": dag.group(1), "label": tekst(label.group(1)) if label else "",
                        "titel": tekst(titel.group(1)) if titel else ""})
    return uit


def evenement(page, label="", naam=""):
    """One event page -> {"ronde", "categorie", "sec", "slug", "titel", "stukjes"} or None without a result.
    The round and category come from a heading like "Voorronde Teams"; older pages have none, then the agenda's
    label (Teams, Duo, Solo) and the event's name or address ("finale" in it) decide."""
    m = re.search(r'mod_nk_livestanden.*?<tbody>(.*?)</tbody>', page, re.S)
    if not m:
        return None
    tijden = []
    for rij in re.findall(r"<tr>(.*?)</tr>", m.group(1), re.S):
        cellen = [tekst(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", rij, re.S)]
        if len(cellen) >= 3 and re.fullmatch(r"\d+", cellen[0]) and re.fullmatch(r"\d+:\d{2}:\d{2}", cellen[-1]):
            u, mi, s = map(int, cellen[-1].split(":"))
            tijden.append((int(cellen[0]), u * 3600 + mi * 60 + s))
    if not tijden:
        return None
    sec = min(t for plaats, t in tijden if plaats == min(p for p, _ in tijden))
    kop = next((tekst(h) for h in re.findall(r"<h2[^>]*>(.*?)</h2>", page, re.S)
                if re.match(r"(voorronde|finale|halve finale)\b", tekst(h), re.I)), "")
    km = re.match(r"(halve finale|voorronde|finale)\s+(\w+'?\w*)", kop, re.I)
    if km and km.group(2).lower() in CATEGORIE:
        ronde, categorie = km.group(1).capitalize(), CATEGORIE[km.group(2).lower()]
    else:
        categorie = CATEGORIE.get(label.strip().lower())
        ronde = "Finale" if re.search(r"finale", naam, re.I) and not re.search(r"halve", naam, re.I) else "Voorronde"
    if not categorie:
        return None
    # the picture's file name: id-<number>-<slug>-artwork[-web].jpg, or [id-]0-artwork-<slug>.jpg
    bestand = re.search(r"/([^/\"]*artwork[^/\"]*)\.(?:jpe?g|png|webp)", page, re.I)
    slug = ""
    if bestand:
        slug = urllib.parse.unquote(bestand.group(1)).lower()
        slug = re.sub(r"^(id-)?[\d-]*", "", slug)
        slug = re.sub(r"-web$", "", re.sub(r"-?artwork-?", "-", slug)).strip("-")
    i = max(page.find("Gemaakte puzzel"), page.find("Welke puzzel"))
    zin = tekst(page[i:][:3000]) if i >= 0 else ""
    titel = re.search(r"puzzel\s+['‘’\"“]([^'’\"”]+)['’\"”]", zin)
    stukjes = re.search(r"(\d[\d.]*)\s+stukjes", zin)
    return {"ronde": ronde, "categorie": categorie, "sec": sec,
            "slug": slug, "titel": titel.group(1).strip() if titel else "",
            "stukjes": int(stukjes.group(1).replace(".", "")) if stukjes else None}


def rijen(afbeeldingen, name_key, agenda_html=None, delay=0.5, log=print, overslaan=()):
    """Every past event with a result, one row per puzzle/year/category/round (the fastest winning time):
    [{"puzzel", "jaar", "sec", "categorie", "ronde", "afbeelding", "stukjes", "datum", "url"}].
    overslaan: event addresses already done before, not fetched again."""
    by_key, by_id = {}, {a["id"]: a for a in afbeeldingen}
    for a in afbeeldingen:
        for k in (name_key(a.get("nl", "")), name_key(a.get("en", "")), name_key(a["id"].replace("-", " "))):
            if k:
                by_key.setdefault(k, a)
    beste = {}
    for ev in evenementen(agenda_html if agenda_html is not None else download(AGENDA_URL)):
        if ev["url"] in overslaan:
            continue
        try:
            e = evenement(download(ev["url"]), ev["label"], ev["titel"] + " " + ev["url"])
        except OSError as err:
            log(f"NK: {ev['url']} could not be read ({err})")
            continue
        finally:
            time.sleep(delay)
        if not e:
            continue
        # the picture: by the file name (often exactly our id), then by the title in the text
        a = by_id.get(e["slug"]) or by_key.get(name_key(e["slug"].replace("-", " "))) or by_key.get(name_key(e["titel"]))
        if not a and not e["titel"]:
            log(f"NK: {ev['url']}: no puzzle named on the page, skipped")
            continue
        # pieces: the text's number only when the picture exists in it (the text is often copied from another
        # event); otherwise the picture's only version, otherwise solo 500 and duo/team 1000 as on the NK
        versies = (a or {}).get("versies") or []
        stukjes = e["stukjes"] if e["stukjes"] in versies else versies[0] if len(versies) == 1 \
            else (500 if e["categorie"] == "Solo" else 1000)
        rij = {"puzzel": (a.get("nl") or a.get("en")) if a else e["titel"],
               "jaar": int(ev["datum"][:4]), "sec": e["sec"], "categorie": e["categorie"], "ronde": e["ronde"],
               "afbeelding": a["id"] if a else "", "stukjes": stukjes, "datum": ev["datum"], "url": ev["url"]}
        k = sleutel(rij, name_key)
        if k not in beste or rij["sec"] < beste[k]["sec"]:
            beste[k] = rij
    return list(beste.values())


def sleutel(r, name_key):
    """A puzzle once per year, category and round: by picture id, otherwise by name."""
    return (r.get("afbeelding") or name_key(r.get("puzzel", "")), int(r.get("jaar") or 0),
            str(r.get("categorie", "")).lower(), str(r.get("ronde", "")).lower())


def nieuw(gevonden, bestaand, name_key):
    """The rows of `gevonden` the tab does not have yet (bestaand: data.json's nk list). A row is already there when
    the tab has that puzzle (by picture id or by name) in that year, category and round, or the very same winning
    time in that year, category and round (the tab may call the puzzle differently, e.g. by its English name)."""
    have = set()
    for n in bestaand:
        k = sleutel(n, name_key)
        have |= {k, (name_key(n.get("puzzel", "")),) + k[1:], ("tijd", n.get("sec")) + k[1:]}
    uit = []
    for r in gevonden:
        k = sleutel(r, name_key)
        if {k, (name_key(r["puzzel"]),) + k[1:], ("tijd", r["sec"]) + k[1:]} & have:
            continue
        uit.append(r)
    return uit
