#!/usr/bin/env python3
"""
Local stand-in for apps-script/Puzzullu.gs, for testing /loggen/ without the real Sheet:
the same actions (addLog, addExemplaar, removeExemplaar, setMissing, setVideoUrl, setRating),
written to testdata/*.csv. Started by MOCK=1 python3 tools/dev.py (port 8099, secret "test").
"""
import csv, http.server, json, os, re, unicodedata
from datetime import date, datetime

T = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "testdata")
SECRET = "test"


def rows(name):
    with open(os.path.join(T, name + ".csv"), encoding="utf-8") as f:
        r = list(csv.reader(f))
    return r[0], r[1:]


def save(name, header, data):
    with open(os.path.join(T, name + ".csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(header); w.writerows(data)


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def dmy(d): return f"{d.day}-{d.month}-{d.year}"


def act(b):
    a = b["action"]
    if a == "addLog":
        h, d = rows("logs")
        nr = max(int(r[0][1:]) for r in d if r and r[0].startswith("L")) + 1
        y, m, dd = map(int, b["datum"].split("-"))
        row = dict(log_id=f"L{nr:04d}", exemplaar_id=b["exemplaar_id"], tijd=b["tijd"], datum=dmy(date(y, m, dd)),
                   makers=", ".join(sorted(b["makers"])), compleet="ja" if b["compleet"] == "ja" else str(b["compleet"]),
                   gefilmd="ja" if b["gefilmd"] else "nee", video_url="", ingevoerd_op=datetime.now().strftime("%d-%m-%Y %H:%M"))
        d.append([row.get(c, "") for c in h]); save("logs", h, d)
        if b.get("missend") is not None:
            h2, d2 = rows("exemplaren"); i = h2.index("missende_stukjes")
            for r in d2:
                if r[0] == b["exemplaar_id"]: r[i] = str(b["missend"])
            save("exemplaren", h2, d2)
        return {"ok": True, "log_id": row["log_id"]}
    if a == "addExemplaar":
        h, d = rows("exemplaren")
        own = ", ".join(sorted(b["eigenaren"]))
        same = [r for r in d if r[1] == b["afbeelding_id"] and r[2] == str(b["stukjes"]) and r[3] == own]
        nr = max([int(r[4] or 1) for r in same], default=0) + 1
        ex = f"{b['afbeelding_id']}-{b['stukjes']}-{slug('-'.join(sorted(b['eigenaren'])))}" + (f"-{nr}" if nr > 1 else "")
        d.append([ex, b["afbeelding_id"], str(b["stukjes"]), own, str(nr), "0", "in bezit", dmy(date.today()), dmy(date.today())])
        save("exemplaren", h, d)
        return {"ok": True, "exemplaar_id": ex, "volgnummer": nr}
    if a in ("removeExemplaar", "setMissing"):
        h, d = rows("exemplaren")
        col, val = ("status", "weg") if a == "removeExemplaar" else ("missende_stukjes", str(b["missend"]))
        for r in d:
            if r[0] == b["exemplaar_id"]: r[h.index(col)] = val
        save("exemplaren", h, d); return {"ok": True}
    if a == "setVideoUrl":
        h, d = rows("logs")
        for r in d:
            if r[0] == b["log_id"]: r[h.index("video_url")] = b["video_url"]; r[h.index("gefilmd")] = "ja"
        save("logs", h, d); return {"ok": True}
    if a == "setRating":
        h, d = rows("afbeeldingen")
        for r in d:
            if r[0] == b["afbeelding_id"]: r[h.index("rating")] = "" if b["rating"] is None else str(b["rating"])
        save("afbeeldingen", h, d); return {"ok": True}
    return {"error": "unknown action " + a}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        res = act(b) if b.get("secret") == SECRET else {"error": "wrong secret"}
        print(f"mock Sheet: {b.get('action')} -> {res}", flush=True)
        out = json.dumps(res).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)


    def log_message(self, fmt, *args):
        pass


http.server.HTTPServer(("127.0.0.1", 8099), Handler).serve_forever()
