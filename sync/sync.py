#!/usr/bin/env python3
"""
Puzzullu sync: fetches the tabs of the Google Sheet as CSV and writes a single data.json for the website.
Runs once a day by default, and at once when the API asks for it (the file sync-now next to data.json).

Standard library only, no pip needed.

The Sheet has two layouts:
  - new (after the migration): tabs Afbeeldingen, Exemplaren, Logs and NK-tijden, read when
    AFBEELDINGEN_GID, EXEMPLAREN_GID and LOGS_GID are set;
  - old (until then): Puzzel Collectie 2.0 (one row per log or per box), Alle uitgaves JvH and
    Voorronde/finale tijden. Names are matched loosely; the real clean-up is the migration.
Both give the same data.json.

Once a day it also fetches the JvH catalogue (jvh.py) into jvh.json, which adds the known piece counts
("versies") and JvH links to data.json. Pictures JvH has and the Sheet not yet are logged; writing them
to the Afbeeldingen tab goes through the Apps Script (step 4). sync-now with {"jvh": true} fetches it at once.

Settings via environment variables (see docker-compose.yml):
  SHEET_ID          ID of the Google Sheet (Jan van Haasteren Puzzel Collectie 3.0)
  COLLECTIE_GID     gid of "Puzzel Collectie 2.0" (old layout)
  UITGAVES_GID      gid of "Alle uitgaves JvH" (old layout)
  NK_GID            gid of "Voorronde/finale tijden" or, after the migration, "NK-tijden"
  AFBEELDINGEN_GID / EXEMPLAREN_GID / LOGS_GID   gids of the new tabs (empty = old layout)
  OUT_FILE          output path (default /data/data.json)
  INTERVAL          seconds between two syncs (default 86400); 0 = run once
  JVH_FILE          the JvH catalogue (default jvh.json next to OUT_FILE), fetched at most once a day
  JVH_SCRAPE        0 = never fetch the JvH catalogue (use the file as it is)
  <NAME>_CSV        optional: a local CSV file instead of Google, e.g. COLLECTIE_CSV=testdata/collectie.csv

  python3 sync/sync.py --snapshot testdata   saves every tab as testdata/<name>.csv (for CSV=1 in tools/dev.py)
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timezone

import jvh
from jvh import name_key, slug

SHEET_ID = os.environ.get("SHEET_ID", "1vjYevi2UsbTKv6OzcFz99j65SVbGRbZt_eLIciEVIHA")
GIDS = {
    "COLLECTIE": os.environ.get("COLLECTIE_GID", "319446101"),
    "UITGAVES": os.environ.get("UITGAVES_GID", "2072732625"),
    "NK": os.environ.get("NK_GID", "1005578444"),
    "AFBEELDINGEN": os.environ.get("AFBEELDINGEN_GID", ""),
    "EXEMPLAREN": os.environ.get("EXEMPLAREN_GID", ""),
    "LOGS": os.environ.get("LOGS_GID", ""),
}
OUT_FILE = os.environ.get("OUT_FILE", "/data/data.json")
INTERVAL = int(os.environ.get("INTERVAL", "86400"))
SYNC_FLAG = os.path.join(os.path.dirname(os.path.abspath(OUT_FILE)), "sync-now")
JVH_FILE = os.environ.get("JVH_FILE") or os.path.join(os.path.dirname(os.path.abspath(OUT_FILE)), "jvh.json")
JVH_SCRAPE = os.environ.get("JVH_SCRAPE", "1") != "0"
JVH_MAX_AGE = 20 * 3600  # fetch the catalogue at most about once a day

EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sheet}/export?format=csv&gid={gid}"
NEW_TABS = ("AFBEELDINGEN", "EXEMPLAREN", "LOGS")


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- fetching

def download(gid):
    url = EXPORT_URL.format(sheet=SHEET_ID, gid=gid)
    req = urllib.request.Request(url, headers={"User-Agent": "puzzullu-sync/1.0 (+https://puzzullu.funkyorbit.nl)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    if text.lstrip().lower().startswith("<!doctype html") or "<html" in text[:200].lower():
        raise RuntimeError("Google returned an HTML page instead of CSV. "
                           "Is the Sheet shared as 'Anyone with the link can view'?")
    return text


def fetch_csv(name):
    local = os.environ.get(f"{name}_CSV")
    if local:
        with open(local, encoding="utf-8") as f:
            return list(csv.reader(f))
    if not GIDS[name]:
        return None
    return list(csv.reader(io.StringIO(download(GIDS[name]))))


# ---------------------------------------------------------------- helpers

def cell(row, i):
    return row[i].strip() if i is not None and i < len(row) else ""


def columns(header, **wanted):
    """Index per column, matched on the start of the (lowercase) header: columns(h, naam=("naam", "name"))."""
    header = [h.strip().lower() for h in header]
    found = {}
    for key, names in wanted.items():
        found[key] = next((i for n in names for i, h in enumerate(header) if h.startswith(n)), None)
    return found


def header_row(rows, first_column):
    """Index of the row whose first cells contain `first_column` (some tabs have title rows above the header)."""
    for i, row in enumerate(rows[:10]):
        if any(c.strip().lower() == first_column for c in row[:3]):
            return i
    return 0


def seconds(t):
    """'1:01:00' or '0:59:26' -> seconds; None when empty or not a time."""
    m = re.fullmatch(r"(\d+):(\d{1,2}):(\d{1,2})", (t or "").strip())
    if not m:
        return None
    h, mi, s = map(int, m.groups())
    return h * 3600 + mi * 60 + s


def iso_date(d):
    """'3-7-2026' or '03-07-2026' (also with / or .) -> '2026-07-03'; None when empty or wrong."""
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", (d or "").strip())
    if not m:
        return None
    dd, mm, yy = map(int, m.groups())
    try:
        return date(yy, mm, dd).isoformat()
    except ValueError:
        return None


def yes(s):
    return (s or "").strip().lower() in ("ja", "yes", "j", "y", "true", "1")


def person(s):
    s = " ".join((s or "").split())
    return s[:1].upper() + s[1:]


def makers(s):
    return sorted({person(m) for m in (s or "").split(",") if m.strip()}, key=str.lower)


def missing(s):
    """Missing pieces: 'Ja' / 'ja' / '0' -> 0, 'Nee - 1' / '1' -> 1, 'Nee' -> None (not complete, number unknown)."""
    s = (s or "").strip().lower()
    if s in ("", "ja", "yes", "compleet"):
        return 0 if s else None
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


def number(s):
    m = re.fullmatch(r"\d+", (s or "").strip().replace(".", ""))
    return int(m.group()) if m else None


# ---------------------------------------------------------------- new layout

def parse_new(tabs):
    rows = tabs["AFBEELDINGEN"]
    c = columns(rows[0], id=("afbeelding_id",), en=("titel_en",), nl=("titel_nl",), tekenaar=("tekenaar",),
                jaar=("jaar",), rating=("rating",), bron=("bron",), url=("jvh_url",), opm=("opmerking",))
    afbeeldingen = [{
        "id": cell(r, c["id"]), "en": cell(r, c["en"]), "nl": cell(r, c["nl"]),
        "tekenaar": cell(r, c["tekenaar"]), "jaar": number(cell(r, c["jaar"])),
        "rating": number(cell(r, c["rating"])), "bron": cell(r, c["bron"]),
        "jvhUrl": cell(r, c["url"]), "opmerking": cell(r, c["opm"]),
    } for r in rows[1:] if cell(r, c["id"])]

    rows = tabs["EXEMPLAREN"]
    c = columns(rows[0], id=("exemplaar_id",), afb=("afbeelding_id",), stukjes=("stukjes",), eigenaar=("eigenaar",),
                nr=("volgnummer",), missend=("missende",), status=("status",))
    exemplaren = [{
        "id": cell(r, c["id"]), "afbeelding": cell(r, c["afb"]), "stukjes": number(cell(r, c["stukjes"])),
        "eigenaar": person(cell(r, c["eigenaar"])), "volgnummer": number(cell(r, c["nr"])) or 1,
        "missend": missing(cell(r, c["missend"])) or 0, "weg": cell(r, c["status"]).lower() == "weg",
    } for r in rows[1:] if cell(r, c["id"])]

    rows = tabs["LOGS"]
    c = columns(rows[0], id=("log_id",), ex=("exemplaar_id",), tijd=("tijd",), datum=("datum",), makers=("makers",),
                compleet=("compleet",), gefilmd=("gefilmd",), video=("video",))
    logs = [{
        "id": cell(r, c["id"]), "exemplaar": cell(r, c["ex"]), "sec": seconds(cell(r, c["tijd"])),
        "datum": iso_date(cell(r, c["datum"])), "makers": makers(cell(r, c["makers"])),
        "missend": missing(cell(r, c["compleet"])), "gefilmd": yes(cell(r, c["gefilmd"])),
        "video": cell(r, c["video"]),
    } for r in rows[1:] if cell(r, c["id"])]  # a log may have no time (done, but not timed)
    return afbeeldingen, exemplaren, logs


# ---------------------------------------------------------------- old layout

def parse_old(tabs):
    afbeeldingen, by_name = [], {}

    def add_afbeelding(en, nl, **extra):
        a = {"id": "", "en": en, "nl": nl, "tekenaar": "", "jaar": None, "rating": None, "bron": "",
             "jvhUrl": "", "opmerking": "", **extra}
        base = slug(en or nl) or "puzzel"
        a["id"], n = base, 2
        while any(x["id"] == a["id"] for x in afbeeldingen):
            a["id"], n = f"{base}-{n}", n + 1
        afbeeldingen.append(a)
        for k in (name_key(en), name_key(nl)):
            if k:
                by_name.setdefault(k, a)
        return a

    rows = tabs["UITGAVES"] or []
    h = header_row(rows, "titel nl")
    c = columns(rows[h], nl=("titel nl",), en=("titel en",), tekenaar=("tekenaar",), jaar=("jaar",),
                opm=("opmerking",), rating=("rating",)) if rows else {}
    for r in rows[h + 1:]:
        if cell(r, c["nl"]) or cell(r, c["en"]):
            add_afbeelding(cell(r, c["en"]), cell(r, c["nl"]), tekenaar=cell(r, c["tekenaar"]),
                           jaar=number(cell(r, c["jaar"])), rating=number(cell(r, c["rating"])),
                           opmerking=cell(r, c["opm"]), bron="jvh-afbeeldingen")

    rows = tabs["COLLECTIE"]
    c = columns(rows[0], en=("naam puzzel engels", "naam engels"), nl=("naam puzzel nederlands", "naam nl"),
                stukjes=("aantal stukjes",), eigenaar=("eigenaar",), compleet=("compleet",), tijd=("tijd",),
                datum=("datum",), makers=("gemaakt door",), gefilmd=("gefilmd",), video=("url video",),
                extra=("kolom 1",))
    exemplaren, logs, unmatched, last_missing = {}, [], set(), {}
    for nr, r in enumerate(rows[1:], start=2):
        en, nl = cell(r, c["en"]), cell(r, c["nl"])
        if not (en or nl):
            continue
        a = by_name.get(name_key(en)) or by_name.get(name_key(nl))
        if not a:
            unmatched.add(en or nl)
            a = add_afbeelding(en, nl, bron="collectie")
        stukjes = number(cell(r, c["stukjes"]))
        eigenaar = person(cell(r, c["eigenaar"]))
        if eigenaar.lower() == "puzzullu":  # no longer an owner (SPEC §9)
            eigenaar = ""
        ex_id = f"{a['id']}-{stukjes or 0}-{slug(eigenaar) or 'zonder'}"
        ex = exemplaren.setdefault(ex_id, {"id": ex_id, "afbeelding": a["id"], "stukjes": stukjes,
                                           "eigenaar": eigenaar, "volgnummer": 1, "missend": 0, "weg": False})
        if "verkocht" in cell(r, c["extra"]).lower():
            ex["weg"] = True
        sec, dag = seconds(cell(r, c["tijd"])), iso_date(cell(r, c["datum"]))
        m = missing(cell(r, c["compleet"]))
        if cell(r, c["compleet"]) and (ex_id not in last_missing or (dag or "") >= last_missing[ex_id][0]):
            last_missing[ex_id] = (dag or "", m)  # the most recent value counts for the box
        if sec is not None or dag:  # done; sometimes without a time ("Te lang", or not timed)
            logs.append({"id": f"r{nr}", "exemplaar": ex_id, "sec": sec, "datum": dag,
                         "makers": makers(cell(r, c["makers"])), "missend": m,
                         "gefilmd": yes(cell(r, c["gefilmd"])), "video": cell(r, c["video"])})
    for ex_id, (_, m) in last_missing.items():
        exemplaren[ex_id]["missend"] = m if m is not None else 1
    if unmatched:
        log(f"{len(unmatched)} name(s) in Puzzel Collectie 2.0 not found in Alle uitgaves JvH "
            f"(added as their own puzzle until the migration): {', '.join(sorted(unmatched)[:10])}"
            f"{' …' if len(unmatched) > 10 else ''}")
    return afbeeldingen, list(exemplaren.values()), logs


# ---------------------------------------------------------------- NK times

def parse_nk(rows, afbeeldingen):
    if not rows:
        return []
    c = columns(rows[0], puzzel=("gemaakte puzzel", "puzzel"), jaar=("jaar",), tijd=("tijd",),
                cat=("team",), ronde=("voorronde",), afb=("afbeelding_id",))
    by_name = {}
    for a in afbeeldingen:
        for k in (name_key(a["nl"]), name_key(a["en"])):
            by_name.setdefault(k, a["id"])
    nk = []
    for r in rows[1:]:
        sec = seconds(cell(r, c["tijd"]))
        if not cell(r, c["puzzel"]) or sec is None:
            continue
        nk.append({"puzzel": cell(r, c["puzzel"]), "jaar": number(cell(r, c["jaar"])), "sec": sec,
                   "categorie": cell(r, c["cat"]).lower(), "ronde": cell(r, c["ronde"]).lower(),
                   "afbeelding": cell(r, c["afb"]) or by_name.get(name_key(cell(r, c["puzzel"])), "")})
    return nk


# ---------------------------------------------------------------- JvH catalogue

def update_jvh(force=False):
    """Fetch the JvH catalogue into JVH_FILE when it is older than a day (or when asked). Keeps the old file on errors."""
    if not JVH_SCRAPE:
        return
    try:
        if not force and time.time() - os.path.getmtime(JVH_FILE) < JVH_MAX_AGE:
            return
    except OSError:
        pass
    try:
        cat = jvh.catalogue()
    except Exception as e:
        log(f"ERROR: JvH catalogue: {e}; keeping the old one")
        return
    write_atomic({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), **cat}, JVH_FILE)
    log(f"JvH catalogue: {len(cat['afbeeldingen'])} pictures from {cat['puzzels']} puzzles "
        f"({cat['combi']} combo boxes left out) -> {JVH_FILE}")


def add_catalogue(afbeeldingen):
    """Known piece counts and JvH links from the catalogue; returns the catalogue pictures the Sheet does not have."""
    try:
        with open(JVH_FILE, encoding="utf-8") as f:
            cat = json.load(f)["afbeeldingen"]
    except (OSError, ValueError, KeyError):
        return []
    by_id, by_key = {c["id"]: c for c in cat}, {}
    for c in cat:
        for k in (name_key(c["nl"]), name_key(c["en"])):
            by_key.setdefault(k, c)
    seen = set()
    for a in afbeeldingen:
        c = by_id.get(a["id"]) or by_key.get(name_key(a["en"])) or by_key.get(name_key(a["nl"]))
        a["versies"] = c["versies"] if c else []
        if c:
            seen.add(c["id"])
            a["jvhUrl"] = a["jvhUrl"] or c["jvhUrl"]
    return [c for c in cat if c["id"] not in seen]


# ---------------------------------------------------------------- data.json

def build(tabs):
    new = all(tabs.get(t) for t in NEW_TABS)
    afbeeldingen, exemplaren, logs = parse_new(tabs) if new else parse_old(tabs)
    logs.sort(key=lambda l: (l["datum"] or "", l["id"]))
    missing_jvh = add_catalogue(afbeeldingen)
    if missing_jvh:
        log(f"{len(missing_jvh)} JvH picture(s) not in the Sheet yet: "
            f"{', '.join(c['nl'] for c in missing_jvh[:8])}{' …' if len(missing_jvh) > 8 else ''}")
    personen = sorted({m for l in logs for m in l["makers"]} | {e["eigenaar"] for e in exemplaren if e["eigenaar"]},
                      key=str.lower)
    return {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "layout": "nieuw" if new else "oud",
        "afbeeldingen": afbeeldingen,
        "exemplaren": exemplaren,
        "logs": logs,
        "nk": parse_nk(tabs.get("NK"), afbeeldingen),
        "personen": personen,
    }


def write_atomic(data, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def sync_once():
    tabs = {}
    for name in GIDS:
        try:
            tabs[name] = fetch_csv(name)
        except Exception as e:
            log(f"WARNING: could not read tab {name.lower()}: {e}")
            tabs[name] = None
    if not all(tabs.get(t) for t in NEW_TABS) and not tabs.get("COLLECTIE"):
        raise RuntimeError("Neither the new tabs nor Puzzel Collectie 2.0 could be read; keeping the old data.")
    data = build(tabs)
    if not data["afbeeldingen"]:
        raise RuntimeError("No puzzles found; keeping the old data.")
    write_atomic(data, OUT_FILE)
    log(f"OK ({data['layout']} layout): {len(data['afbeeldingen'])} puzzles, {len(data['exemplaren'])} boxes, "
        f"{len(data['logs'])} logs, {len(data['nk'])} NK times -> {OUT_FILE}")
    return data


def wait():
    """Sleep INTERVAL seconds, or less when the API asks for a sync. Returns the sync-now contents
    ({"log": id} and/or {"jvh": true}; {} for a plain update), or None after INTERVAL."""
    end = time.time() + INTERVAL
    while time.time() < end:
        if os.path.exists(SYNC_FLAG):
            try:
                with open(SYNC_FLAG, encoding="utf-8") as f:
                    asked = json.load(f)
            except (OSError, ValueError):
                asked = {}
            try:
                os.remove(SYNC_FLAG)  # first, so a new log during this sync asks again
            except OSError:
                pass
            return asked if isinstance(asked, dict) else {}
        time.sleep(2)
    return None


def snapshot(folder):
    os.makedirs(folder, exist_ok=True)
    for name, gid in GIDS.items():
        if gid:
            path = os.path.join(folder, f"{name.lower()}.csv")
            with open(path, "w", encoding="utf-8") as f:
                f.write(download(gid))
            log(f"saved {path}")


def main():
    if sys.argv[1:2] == ["--snapshot"]:
        return snapshot(sys.argv[2] if len(sys.argv) > 2 else "testdata")
    asked = {}
    while True:
        update_jvh(force=bool(asked and asked.get("jvh")))
        want = str(asked.get("log") or "") if asked else ""
        # Google's CSV export can lag a few seconds behind a change: try again until the new log is in
        for attempt in range(6 if want else 1):
            try:
                data = sync_once()
                if not want or any(l["id"] == want for l in data["logs"]):
                    break
                log(f"log {want} not in the export yet, trying again")
            except Exception as e:  # the old data.json stays in place
                log(f"ERROR: {e}")
                if INTERVAL == 0:
                    sys.exit(1)
            time.sleep(5)
        if INTERVAL == 0:
            break
        asked = wait()
        if asked is not None:
            log("sync asked for" + (f" (new log {asked['log']})" if asked.get("log") else "")
                + (" (JvH catalogue)" if asked.get("jvh") else ""))

if __name__ == "__main__":
    main()
