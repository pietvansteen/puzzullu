#!/usr/bin/env python3
"""
Puzzullu sync: fetches the tabs of the Google Sheet as CSV and writes a single data.json for the website.
Runs once a day by default, and at once when the API asks for it (the file sync-now next to data.json).

Standard library only, no pip needed.

The Sheet has two layouts:
  - new (since the migration of 28-10-2026): tabs Afbeeldingen, Exemplaren, Logs and NK-tijden;
  - old (before it): Puzzel Collectie 2.0 (one row per log or per box), Alle uitgaves JvH and
    Voorronde/finale tijden, read only when COLLECTIE_GID is set and the new tabs are missing.
    Names are matched loosely; the real clean-up was the migration.
Both give the same data.json.

Once a day it also fetches the JvH catalogue (jvh.py) into jvh.json, which adds the known piece counts
("versies") and JvH links to data.json. Pictures JvH has and the Sheet not yet are added to the Afbeeldingen tab
through the Apps Script (when SHEET_WRITE_URL is set). sync-now with {"jvh": true} fetches it at once.

sync-now may also hold {"wacht": {"lijst": "logs", "id": "L0536", "veld": "video", "waarde": "https://..."}}
(written by the API after a change): Google's CSV export can lag behind, so the sync tries again until data.json
shows that change (the item exists, and when "veld" is given, has that value).

Settings via environment variables (see docker-compose.yml):
  SHEET_ID          ID of the Google Sheet (Jan van Haasteren Puzzel Collectie 3.0)
  AFBEELDINGEN_GID / EXEMPLAREN_GID / LOGS_GID / NK_GID   gids of the tabs Afbeeldingen, Exemplaren, Logs, NK-tijden
  COLLECTIE_GID / UITGAVES_GID   gids of the old tabs (empty by default; only for the old layout)
  OUT_FILE          output path (default /data/data.json)
  INTERVAL          seconds between two syncs (default 86400); 0 = run once
  JVH_FILE          the JvH catalogue (default jvh.json next to OUT_FILE), fetched at most once a day
  JVH_SCRAPE        0 = never fetch the JvH catalogue (use the file as it is)
  SHEET_WRITE_URL / SHEET_WRITE_SECRET   the Apps Script, to add new JvH pictures to Afbeeldingen (optional)
  <NAME>_CSV        optional: a local CSV file instead of Google, e.g. LOGS_CSV=testdata/logs.csv

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
    "COLLECTIE": os.environ.get("COLLECTIE_GID", ""),  # old layout, 319446101 (only read when set)
    "UITGAVES": os.environ.get("UITGAVES_GID", ""),    # old layout, 2072732625
    "NK": os.environ.get("NK_GID", "1140165965"),
    "AFBEELDINGEN": os.environ.get("AFBEELDINGEN_GID", "1862380862"),
    "EXEMPLAREN": os.environ.get("EXEMPLAREN_GID", "1821732204"),
    "LOGS": os.environ.get("LOGS_GID", "1071758480"),
}
OUT_FILE = os.environ.get("OUT_FILE", "/data/data.json")
INTERVAL = int(os.environ.get("INTERVAL", "86400"))
SYNC_FLAG = os.path.join(os.path.dirname(os.path.abspath(OUT_FILE)), "sync-now")
JVH_FILE = os.environ.get("JVH_FILE") or os.path.join(os.path.dirname(os.path.abspath(OUT_FILE)), "jvh.json")
JVH_SCRAPE = os.environ.get("JVH_SCRAPE", "1") != "0"
SHEET_WRITE_URL = os.environ.get("SHEET_WRITE_URL", "")
SHEET_WRITE_SECRET = os.environ.get("SHEET_WRITE_SECRET", "")
JVH_MAX_AGE = 20 * 3600  # fetch the catalogue at most about once a day
NAMEN_FILE = os.path.join(os.path.dirname(os.path.abspath(JVH_FILE)), "jvh-namen.json")
NAMEN_MAX_AGE = 7 * 24 * 3600  # the other names from the detail pages (about 320 pages): once a week

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


def iso_moment(d):
    """'28-10-2026 14:09' (the Sheet's ingevoerd_op) -> '2026-10-28T14:09'; None when empty or wrong."""
    m = re.fullmatch(r"(\S+)\s+(\d{1,2}):(\d{2})(?::\d{2})?", (d or "").strip())
    dag = m and iso_date(m.group(1))
    if not dag or int(m.group(2)) > 23 or int(m.group(3)) > 59:
        return None
    return f"{dag}T{int(m.group(2)):02d}:{m.group(3)}"


def yes(s):
    return (s or "").strip().lower() in ("ja", "yes", "j", "y", "true", "1")


def person(s):
    s = " ".join((s or "").split())
    return s[:1].upper() + s[1:]


def makers(s):
    """Comma-separated names, also for owners (a box can have more than one owner)."""
    return sorted({person(m) for m in (s or "").split(",") if m.strip()}, key=str.lower)


# old layout: Puzzullu is no longer an owner, "Lau & Dix" are the two owners Dixie and Lauren (SPEC §9)
OLD_OWNERS = {"puzzullu": "", "lau & dix": "Dixie, Lauren"}


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
        "eigenaren": makers(cell(r, c["eigenaar"])), "volgnummer": number(cell(r, c["nr"])) or 1,
        "missend": missing(cell(r, c["missend"]) or "0"), "weg": cell(r, c["status"]).lower() == "weg",
    } for r in rows[1:] if cell(r, c["id"])]

    rows = tabs["LOGS"]
    c = columns(rows[0], id=("log_id",), ex=("exemplaar_id",), tijd=("tijd",), datum=("datum",), makers=("makers",),
                compleet=("compleet",), gefilmd=("gefilmd",), video=("video",), ingevoerd=("ingevoerd_op",))
    logs = [{
        "id": cell(r, c["id"]), "exemplaar": cell(r, c["ex"]), "sec": seconds(cell(r, c["tijd"])),
        "datum": iso_date(cell(r, c["datum"])), "makers": makers(cell(r, c["makers"])),
        "missend": missing(cell(r, c["compleet"])), "gefilmd": yes(cell(r, c["gefilmd"])),
        "video": cell(r, c["video"]), "ingevoerd": iso_moment(cell(r, c["ingevoerd"])),
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
        eigenaar = cell(r, c["eigenaar"])
        eigenaren = makers(OLD_OWNERS.get(" ".join(eigenaar.lower().split()), eigenaar))
        ex_id = f"{a['id']}-{stukjes or 0}-{slug('-'.join(eigenaren)) or 'zonder'}"
        ex = exemplaren.setdefault(ex_id, {"id": ex_id, "afbeelding": a["id"], "stukjes": stukjes,
                                           "eigenaren": eigenaren, "volgnummer": 1, "missend": 0, "weg": False})
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
        exemplaren[ex_id]["missend"] = m
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
                cat=("team",), ronde=("voorronde",), afb=("afbeelding_id",), stukjes=("stukjes",))
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
                   "stukjes": number(cell(r, c["stukjes"])),
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


def update_namen(force=False):
    """The other names of each picture from JvH's detail pages into NAMEN_FILE, once a week (or when asked).
    Returns True when the file changed. Keeps the old file on errors."""
    if not JVH_SCRAPE:
        return False
    try:
        if not force and time.time() - os.path.getmtime(NAMEN_FILE) < NAMEN_MAX_AGE:
            return False
    except OSError:
        pass  # not fetched yet
    try:
        with open(JVH_FILE, encoding="utf-8") as f:
            cat = json.load(f)["afbeeldingen"]
    except (OSError, ValueError, KeyError):
        return False
    try:
        names = jvh.namen(cat)
    except Exception as e:
        log(f"ERROR: JvH names: {e}; keeping the old ones")
        return False
    write_atomic({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "namen": names}, NAMEN_FILE)
    log(f"JvH names: {sum(len(v) for v in names.values())} other names for {len(names)} pictures -> {NAMEN_FILE}")
    return True


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
    try:
        with open(NAMEN_FILE, encoding="utf-8") as f:
            other = json.load(f)["namen"]
    except (OSError, ValueError, KeyError):
        other = {}
    seen, sheet_of = set(), {}
    for a in afbeeldingen:
        c = by_id.get(a["id"]) or by_key.get(name_key(a["en"])) or by_key.get(name_key(a["nl"]))
        a["versies"] = c["versies"] if c else []
        a["namen"], a["verwant"] = [], []
        if c:
            seen.add(c["id"])
            sheet_of[c["id"]] = a
            a["jvhUrl"] = a["jvhUrl"] or c["jvhUrl"]
            a["namen"] = [n for n in other.get(c["id"], []) if n not in (a["en"], a["nl"]) and not jvh.is_combo_name(n)]
    # a name on one picture's page that is another picture's title links the two (Grand Prix <-> Nog één rondje Zandvoort)
    sheet_key = {}
    for a in afbeeldingen:
        for k in (name_key(a["nl"]), name_key(a["en"])):
            sheet_key.setdefault(k, a)
    for a in afbeeldingen:
        for n in a["namen"]:
            b = sheet_key.get(name_key(n))
            if b and b is not a:
                if b["id"] not in a["verwant"]:
                    a["verwant"].append(b["id"])
                if a["id"] not in b["verwant"]:
                    b["verwant"].append(a["id"])
    return [c for c in cat if c["id"] not in seen]


def add_to_sheet(pictures):
    """New JvH pictures to the Afbeeldingen tab, through the Apps Script; they show on the site after the next sync."""
    if not (SHEET_WRITE_URL and SHEET_WRITE_SECRET):
        return
    payload = {"secret": SHEET_WRITE_SECRET, "action": "addAfbeeldingen", "afbeeldingen": [
        {"afbeelding_id": c["id"], "titel_en": c["en"], "titel_nl": c["nl"], "tekenaar": c["tekenaar"],
         "jaar": c["jaar"] or "", "bron": c["bron"], "jvh_url": c["jvhUrl"]} for c in pictures]}
    try:
        req = urllib.request.Request(SHEET_WRITE_URL, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        log(f"JvH pictures added to the Sheet: {result.get('added')}" if result.get("ok") else f"Apps Script said: {result}")
    except (OSError, ValueError) as e:
        log(f"WARNING: could not add the JvH pictures to the Sheet: {e}")


# ---------------------------------------------------------------- data.json

def build(tabs):
    new = all(tabs.get(t) for t in NEW_TABS)
    afbeeldingen, exemplaren, logs = parse_new(tabs) if new else parse_old(tabs)
    logs.sort(key=lambda l: (l["datum"] or "", l["id"]))
    missing_jvh = add_catalogue(afbeeldingen)
    if missing_jvh:
        log(f"{len(missing_jvh)} JvH picture(s) not in the Sheet yet: "
            f"{', '.join(c['nl'] for c in missing_jvh[:8])}{' …' if len(missing_jvh) > 8 else ''}")
        if new:
            add_to_sheet(missing_jvh)
    personen = sorted({m for l in logs for m in l["makers"]} | {p for e in exemplaren for p in e["eigenaren"]},
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
        want = (asked or {}).get("wacht") or ({"lijst": "logs", "id": asked["log"]} if (asked or {}).get("log") else None)
        # Google's CSV export can lag a few seconds behind a change: try again until the change is in
        for attempt in range(8 if want else 1):
            try:
                data = sync_once()
                if not want or shows(data, want):
                    break
                log(f"{want.get('lijst')} {want.get('id')} not changed in the export yet, trying again")
            except Exception as e:  # the old data.json stays in place
                log(f"ERROR: {e}")
                if INTERVAL == 0:
                    sys.exit(1)
            time.sleep(5)
        # the other names (weekly, slow): after the sync, so a new log never waits for it
        if update_namen(force=bool(asked and asked.get("jvh"))):
            try:
                sync_once()
            except Exception as e:
                log(f"ERROR: {e}")
        if INTERVAL == 0:
            break
        asked = wait()
        if asked is not None:
            log("sync asked for" + (f" (waiting for {asked['wacht']})" if asked.get("wacht") else "")
                + (" (JvH catalogue)" if asked.get("jvh") else ""))


def shows(data, want):
    """Does data.json show the change the API made? (see "wacht" at the top)"""
    item = next((x for x in data.get(want.get("lijst"), []) if x["id"] == want.get("id")), None)
    return item is not None and ("veld" not in want or item.get(want["veld"]) == want.get("waarde"))

if __name__ == "__main__":
    main()
