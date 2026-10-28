"""
The JvH catalogue, from the two lists in the "digitaal museum" of jvh-puzzels.nl (server-rendered HTML):
  1. Lijst alle afbeeldingen: one row per picture (NL, EN, artist, year of first release, detail link)
  2. Lijst alle puzzels: one row per edition (NL, EN, article number, series, pieces or "Combidoos",
     artist, client, release date, publisher, detail link)

catalogue() combines them: every picture of list 1, plus titles of list 2 that are not in list 1
(derived editions such as "In de drukte!", their own picture with bron "jvh-puzzels"). Combo boxes
are left out as a picture of their own (their title has "/" or "&" between the names). Every picture
gets the piece counts of its editions ("versies"); an XXXL edition ("De Storm - XXXL") counts as a version
of its picture.

Standard library only. Used by sync.py (daily) and tools/migratie.py.
"""

import html.parser
import re
import unicodedata
import urllib.request

BASE = "https://www.jvh-puzzels.nl/"
AFBEELDINGEN_URL = BASE + "digitaal-museum/overzicht-alle-puzzels/lijst-alle-afbeeldingen.html"
PUZZELS_URL = BASE + "digitaal-museum/overzicht-alle-puzzels/lijst-alle-puzzels.html"
USER_AGENT = "puzzullu-sync/1.0 (+https://puzzullu.funkyorbit.nl; daily catalogue check)"

# fail-safe: fewer rows than this means the page changed or broke, and nothing is used
MIN_AFBEELDINGEN = 250
MIN_PUZZELS = 800


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def name_key(s):
    """Loose key for matching puzzle names: no case, accents, spaces or punctuation (Air Show = Airshow!)."""
    return slug(s).replace("-", "")


class TableParser(html.parser.HTMLParser):
    """Rows of the first <table> as {td class: text}, plus "href" for the detail link."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cls, self.in_table, self.done = [], None, None, False, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and not self.done:
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.row = {}
        elif self.row is not None and tag == "td":
            self.cls = (a.get("class") or "").split()[0] if a.get("class") else None
            if self.cls:
                self.row.setdefault(self.cls, "")
        elif self.row is not None and tag == "a" and a.get("href"):
            self.row["href"] = a["href"]

    def handle_endtag(self, tag):
        if tag == "td":
            self.cls = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append({k: " ".join(v.split()) for k, v in self.row.items()})
            self.row = None
        elif tag == "table" and self.in_table:
            self.in_table, self.done = False, True

    def handle_data(self, data):
        if self.row is not None and self.cls:
            self.row[self.cls] += data


def parse_table(text):
    p = TableParser()
    p.feed(text)
    return p.rows


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", "replace")


def detail_slug(href):
    m = re.search(r"/detail/([^/]+?)\.html", href or "")
    return m.group(1) if m else ""


def is_combo(row):
    return row.get("stukjes", "").lower().startswith("combi") or bool(re.search(r"\s[/&]\s", row.get("first-lang", "")))


def base_titles(row):
    """Titles to look up an edition's picture by: as written, then without " - XXXL" (De Storm - XXXL is
    the 3162-piece version of De Storm) and the part before "/" (Flea Market/Antique Antics)."""
    titles = [row.get("first-lang", ""), row.get("second-lang", "")]
    for t in list(titles):
        titles.append(re.sub(r"\s*-?\s*XXXL$", "", t, flags=re.I))
        titles.append(t.split("/")[0])
    return [t for t in titles if t.strip()]


def catalogue(afbeeldingen_html=None, puzzels_html=None):
    """Returns {"afbeeldingen": [...], "puzzels": n, "combi": n}; raises RuntimeError when a page looks wrong."""
    rows1 = parse_table(afbeeldingen_html if afbeeldingen_html is not None else download(AFBEELDINGEN_URL))
    rows2 = parse_table(puzzels_html if puzzels_html is not None else download(PUZZELS_URL))
    rows1 = [r for r in rows1 if r.get("first-lang") or r.get("second-lang")]
    rows2 = [r for r in rows2 if r.get("first-lang") or r.get("second-lang")]
    if len(rows1) < MIN_AFBEELDINGEN or len(rows2) < MIN_PUZZELS:
        raise RuntimeError(f"JvH lists look wrong ({len(rows1)} pictures, {len(rows2)} puzzles); nothing used")

    afbeeldingen, by_key, ids = [], {}, set()

    def add(row, bron, href_key):
        a = {"id": detail_slug(row.get("href")) or slug(row.get("first-lang") or row.get("second-lang")),
             "nl": row.get("first-lang", ""), "en": row.get("second-lang", ""), "tekenaar": row.get("tekenaar", ""),
             "jaar": None, "bron": bron, "jvhUrl": BASE + row["href"] if row.get("href") else "", "versies": []}
        base, n = a["id"], 2
        while a["id"] in ids:  # JvH has a few detail pages with the same name
            a["id"], n = f"{base}-{n}", n + 1
        ids.add(a["id"])
        jaar = re.search(r"\d{4}", row.get(href_key, ""))
        a["jaar"] = int(jaar.group()) if jaar else None
        afbeeldingen.append(a)
        for k in (name_key(a["nl"]), name_key(a["en"])):
            if k:
                by_key.setdefault(k, a)
        return a

    for r in rows1:
        add(r, "jvh-afbeeldingen", "jaar-uitgifte")
    combi = 0
    for r in sorted(rows2, key=lambda r: r.get("releasedatum", "")):
        if is_combo(r):
            combi += 1
            continue
        a = next((by_key[k] for k in map(name_key, base_titles(r)) if k in by_key), None)
        if not a:
            a = add(r, "jvh-puzzels", "releasedatum")
        stukjes = re.fullmatch(r"\d+", r.get("stukjes", "").replace(".", ""))
        if stukjes and int(stukjes.group()) not in a["versies"]:
            a["versies"].append(int(stukjes.group()))
    for a in afbeeldingen:
        a["versies"].sort()
    return {"afbeeldingen": afbeeldingen, "puzzels": len(rows2), "combi": combi}
