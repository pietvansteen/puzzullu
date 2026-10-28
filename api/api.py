#!/usr/bin/env python3
"""
Puzzullu API behind nginx on /api/. Standard library only, no pip needed.

  GET  /api/health          is the API up, and how old is data.json
  GET  /api/auth            checks the password (Authorization: Bearer <ADMIN_TOKEN>)
  POST /api/sync            asks the sync to fetch the Sheet now (writes data/sync-now)
  POST /api/jvh             the same, and fetch the JvH catalogue now too
  POST /api/log             a time:          {exemplaar_id, tijd "u:mm:ss" | "", datum "YYYY-MM-DD", makers [..],
                                              compleet "ja" | n, gefilmd, missend n | null}
  POST /api/exemplaar       a new box:       {afbeelding_id, stukjes, eigenaren [..]}
  POST /api/exemplaar/weg   a box is gone:   {exemplaar_id}
  POST /api/missend         missing pieces:  {exemplaar_id, missend}
  POST /api/video           a video link:    {log_id, video_url}
  POST /api/rating          difficulty:      {afbeelding_id, rating 1..5 | null}

Every write action needs the password and goes to the Sheet's Apps Script (SHEET_WRITE_URL + SHEET_WRITE_SECRET,
apps-script/Puzzullu.gs). After it the sync runs at once and waits until Google's CSV export shows the change.
Wrong passwords are rate-limited per address. A body may carry "id" (a random string), so a retry is not saved twice.

Settings via environment variables (see docker-compose.yml):
  ADMIN_TOKEN          the shared password for /loggen/ (without it no admin call is allowed)
  SHEET_WRITE_URL      the /exec URL of the Apps Script web app
  SHEET_WRITE_SECRET   its script property SECRET
  DATA_FILE            path of data.json (default /data/data.json); sync-now goes next to it
  PORT                 default 8000
"""

import hmac
import http.server
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
SHEET_WRITE_URL = os.environ.get("SHEET_WRITE_URL", "")
SHEET_WRITE_SECRET = os.environ.get("SHEET_WRITE_SECRET", "")
DATA_FILE = os.environ.get("DATA_FILE", "/data/data.json")
PORT = int(os.environ.get("PORT", "8000"))
SYNC_FLAG = os.path.join(os.path.dirname(os.path.abspath(DATA_FILE)), "sync-now")

MAX_FAILS, FAIL_WINDOW = 10, 15 * 60  # 10 wrong passwords per address per 15 minutes
fails = {}

ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
KEY_RE = re.compile(r"^[a-z0-9%][a-z0-9%-]{0,120}$")  # afbeelding_id / exemplaar_id (slugs; JvH has one with %C3%A8)
LOG_RE = re.compile(r"^L\d{1,6}$")
TIME_RE = re.compile(r"^\d{1,3}:[0-5]\d:[0-5]\d$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NAME_RE = re.compile(r"^[^\s,][^,]{0,39}$")


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def ask_sync(**what):
    """Write sync-now: {} = update from the Sheet, wacht={...} = until the export shows that change,
    jvh=True = fetch the JvH catalogue too."""
    tmp = SYNC_FLAG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(what, f)
    os.replace(tmp, SYNC_FLAG)


class Invalid(ValueError):
    """A request that does not make sense; the message goes to the page as it is (Dutch)."""


def names(value, what):
    if not isinstance(value, list) or not value:
        raise Invalid(f"Kies minstens één {what}.")
    out = [" ".join(str(n).split()) for n in value]
    if any(not NAME_RE.match(n) for n in out):
        raise Invalid(f"Een naam bij {what} klopt niet (geen komma's, hooguit 40 tekens).")
    return out


def key(value, what):
    value = str(value or "")
    if not KEY_RE.match(value):
        raise Invalid(f"Onbekende {what}.")
    return value


def number(value, what, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise Invalid(f"{what} moet een heel getal van {low} tot {high} zijn.")
    return value


# action, how to check the body, and what the sync waits for: (data.json list, id field of the answer or body, field, value)
def check_log(b):
    tijd = str(b.get("tijd") or "")
    if tijd and not TIME_RE.match(tijd):
        raise Invalid("De tijd moet u:mm:ss zijn.")
    datum = str(b.get("datum") or "")
    try:
        if not DATE_RE.match(datum):
            raise ValueError
        time.strptime(datum, "%Y-%m-%d")
    except ValueError:
        raise Invalid("Kies een datum.")
    compleet = b.get("compleet")
    if compleet != "ja":
        number(compleet, "Het aantal missende stukjes", 1, 9999)
    missend = b.get("missend")
    if missend is not None:
        number(missend, "Het aantal missende stukjes", 0, 9999)
    return {"exemplaar_id": key(b.get("exemplaar_id"), "doos"), "tijd": tijd, "datum": datum,
            "makers": names(b.get("makers"), "maker"), "compleet": compleet, "gefilmd": bool(b.get("gefilmd")),
            "missend": missend}


def check_exemplaar(b):
    return {"afbeelding_id": key(b.get("afbeelding_id"), "puzzel"),
            "stukjes": number(b.get("stukjes"), "Het aantal stukjes", 1, 99999),
            "eigenaren": names(b.get("eigenaren"), "eigenaar")}


def check_video(b):
    url = str(b.get("video_url") or "").strip()
    if not re.match(r"^https://\S{4,300}$", url):
        raise Invalid("Plak een link die begint met https://")
    log_id = str(b.get("log_id") or "")
    if not LOG_RE.match(log_id):
        raise Invalid("Onbekende tijd.")
    return {"log_id": log_id, "video_url": url}


def check_rating(b):
    r = b.get("rating")
    return {"afbeelding_id": key(b.get("afbeelding_id"), "puzzel"), "rating": None if r is None else number(r, "De rating", 1, 5)}


ACTIONS = {
    "/api/log": ("addLog", check_log, lambda b, r: {"lijst": "logs", "id": r.get("log_id")}),
    "/api/exemplaar": ("addExemplaar", check_exemplaar, lambda b, r: {"lijst": "exemplaren", "id": r.get("exemplaar_id")}),
    "/api/exemplaar/weg": ("removeExemplaar", lambda b: {"exemplaar_id": key(b.get("exemplaar_id"), "doos")},
                           lambda b, r: {"lijst": "exemplaren", "id": b["exemplaar_id"], "veld": "weg", "waarde": True}),
    "/api/missend": ("setMissing", lambda b: {"exemplaar_id": key(b.get("exemplaar_id"), "doos"),
                                              "missend": number(b.get("missend"), "Het aantal missende stukjes", 0, 9999)},
                     lambda b, r: {"lijst": "exemplaren", "id": b["exemplaar_id"], "veld": "missend", "waarde": b["missend"]}),
    "/api/video": ("setVideoUrl", check_video,
                   lambda b, r: {"lijst": "logs", "id": b["log_id"], "veld": "video", "waarde": b["video_url"]}),
    "/api/rating": ("setRating", check_rating,
                    lambda b, r: {"lijst": "afbeeldingen", "id": b["afbeelding_id"], "veld": "rating", "waarde": b["rating"]}),
}


def to_sheet(action, fields, req_id):
    """Send one action to the Apps Script; returns its answer (a dict) or raises OSError/ValueError."""
    payload = {"secret": SHEET_WRITE_SECRET, "id": req_id, "action": action, **fields}
    # Apps Script answers with a redirect to the result, which urllib follows as a GET
    req = urllib.request.Request(SHEET_WRITE_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "puzzullu-api"

    def client(self):
        return self.headers.get("CF-Connecting-IP") or self.headers.get("X-Real-IP") or self.client_address[0]

    def send(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        """True with the right password; otherwise sends 401 or 429 and returns False."""
        ip, now = self.client(), time.time()
        recent = [t for t in fails.get(ip, []) if now - t < FAIL_WINDOW]
        if len(recent) >= MAX_FAILS:
            self.send(429, {"error": "Te veel foute pogingen. Probeer het over een kwartier opnieuw."})
            return False
        given = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if ADMIN_TOKEN and hmac.compare_digest(given.encode(), ADMIN_TOKEN.encode()):
            fails.pop(ip, None)
            return True
        fails[ip] = recent + [now]
        self.send(401, {"error": "Verkeerd wachtwoord."})
        return False

    def body(self, limit=8192):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > limit:
                return None
            value = json.loads(self.rfile.read(n) or b"{}")
            return value if isinstance(value, dict) else None
        except (ValueError, OSError):
            return None

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            try:
                age = round(time.time() - os.path.getmtime(DATA_FILE))
            except OSError:
                age = None
            return self.send(200, {"ok": True, "dataAgeSeconds": age, "schrijven": bool(SHEET_WRITE_URL and SHEET_WRITE_SECRET)})
        if path == "/api/auth":
            if self.authorized():
                self.send(200, {"ok": True, "schrijven": bool(SHEET_WRITE_URL and SHEET_WRITE_SECRET)})
            return
        self.send(404, {"error": "Onbekend adres."})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path in ("/api/sync", "/api/jvh"):
            if self.authorized():
                ask_sync(jvh=True) if path == "/api/jvh" else ask_sync()
                log("sync asked for" + (" with JvH catalogue" if path == "/api/jvh" else ""))
                self.send(200, {"ok": True})
            return
        if path in ACTIONS:
            if self.authorized():
                self.write(path)
            return
        self.send(404, {"error": "Onbekend adres."})

    def write(self, path):
        action, check, wait_for = ACTIONS[path]
        b = self.body()
        if b is None:
            return self.send(400, {"error": "Ongeldige aanvraag."})
        try:
            fields = check(b)
        except Invalid as e:
            return self.send(400, {"error": str(e)})
        if not (SHEET_WRITE_URL and SHEET_WRITE_SECRET):
            return self.send(503, {"error": "Opslaan in de Sheet is nog niet ingesteld (SHEET_WRITE_URL in .env)."})
        req_id = str(b.get("id") or "")
        try:
            result = to_sheet(action, fields, req_id if ID_RE.match(req_id) else "")
        except (urllib.error.URLError, OSError, ValueError) as e:
            log(f"{action}: the Sheet could not be reached: {e}")
            return self.send(502, {"error": "De Sheet is niet bereikbaar. Probeer het zo nog een keer."})
        if not isinstance(result, dict) or not result.get("ok"):
            log(f"{action}: the Sheet said: {result}")
            return self.send(502, {"error": f"De Sheet zei: {(result or {}).get('error', 'geen antwoord')}"})
        ask_sync(wacht=wait_for(fields, result))
        log(f"{action} saved: {json.dumps(result, ensure_ascii=False)}")
        self.send(200, result)

    def log_message(self, fmt, *args):
        pass  # no access log with addresses; errors are logged by log()


def main():
    if not ADMIN_TOKEN:
        log("WARNING: no ADMIN_TOKEN set; every admin call is refused")
    if not (SHEET_WRITE_URL and SHEET_WRITE_SECRET):
        log("no SHEET_WRITE_URL/SHEET_WRITE_SECRET: saving to the Sheet is off")
    log(f"listening on port {PORT}")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
