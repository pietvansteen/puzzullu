#!/usr/bin/env python3
"""
Puzzullu API behind nginx on /api/. Standard library only, no pip needed.

  GET  /api/health   is the API up, and how old is data.json
  GET  /api/auth     checks the password (Authorization: Bearer <ADMIN_TOKEN>)
  POST /api/sync     asks the sync to fetch the Sheet now (writes data/sync-now)
  POST /api/jvh      the same, and fetch the JvH catalogue now too

The write actions (logging a time, owners, video links, ratings) come in step 4 and go to the Apps Script
(SHEET_WRITE_URL + SHEET_WRITE_SECRET). Wrong passwords are rate-limited per address.

Settings via environment variables (see docker-compose.yml):
  ADMIN_TOKEN   the shared password for /loggen/ (without it no admin call is allowed)
  DATA_FILE     path of data.json (default /data/data.json); sync-now goes next to it
  PORT          default 8000
"""

import hmac
import http.server
import json
import os
import time
from datetime import datetime

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
DATA_FILE = os.environ.get("DATA_FILE", "/data/data.json")
PORT = int(os.environ.get("PORT", "8000"))
SYNC_FLAG = os.path.join(os.path.dirname(os.path.abspath(DATA_FILE)), "sync-now")

MAX_FAILS, FAIL_WINDOW = 10, 15 * 60  # 10 wrong passwords per address per 15 minutes
fails = {}


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def ask_sync(**what):
    """Write sync-now: {} = update from the Sheet, log="<id>" = wait for that log, jvh=True = fetch the JvH catalogue too."""
    tmp = SYNC_FLAG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(what, f)
    os.replace(tmp, SYNC_FLAG)


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

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            try:
                age = round(time.time() - os.path.getmtime(DATA_FILE))
            except OSError:
                age = None
            return self.send(200, {"ok": True, "dataAgeSeconds": age})
        if path == "/api/auth":
            if self.authorized():
                self.send(200, {"ok": True})
            return
        self.send(404, {"error": "Onbekend adres."})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/sync":
            if self.authorized():
                ask_sync()
                log("sync asked for")
                self.send(200, {"ok": True})
            return
        if path == "/api/jvh":
            if self.authorized():
                ask_sync(jvh=True)
                log("sync with JvH catalogue asked for")
                self.send(200, {"ok": True})
            return
        self.send(404, {"error": "Onbekend adres."})

    def log_message(self, fmt, *args):
        pass  # no access log with addresses; errors are logged by log()


def main():
    if not ADMIN_TOKEN:
        log("WARNING: no ADMIN_TOKEN set; every admin call is refused")
    log(f"listening on port {PORT}")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
