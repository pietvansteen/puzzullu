#!/usr/bin/env python3
"""
Puzzullu local server: the whole site as on the server, on http://localhost:8091

  python3 tools/dev.py

Starts the API (port 8001) and the sync (live Sheet, waits for sync-now like on the server),
and serves site/ with /data.json and /api/ as web/nginx.conf does. Data goes to data/ (gitignored).
Settings come from .env next to docker-compose.yml (gitignored): ADMIN_TOKEN (default "test"),
SHEET_WRITE_URL and SHEET_WRITE_SECRET (without them /loggen/ cannot save).
Add CSV=1 to sync from testdata/ instead of the live Sheet (fill it with: python3 sync/sync.py --snapshot testdata).
Ctrl+C stops everything.
"""

import http.server
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "8091"))
API_PORT = 8001
API = f"http://127.0.0.1:{API_PORT}"
TABS = ("COLLECTIE", "UITGAVES", "NK", "AFBEELDINGEN", "EXEMPLAREN", "LOGS")


def read_env():
    env = {}
    try:
        with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
            for line in f:
                key, sep, value = line.strip().partition("=")
                if sep and not key.startswith("#"):
                    env[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(ROOT, "site"), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def proxy(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = urllib.request.Request(API + self.path, data=self.rfile.read(n) if n else None, method=self.command,
                                     headers={k: v for k, v in self.headers.items() if k.lower() in ("authorization", "content-type")})
        try:
            resp = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            resp = e
        except OSError:
            return self.send_error(502, "API not reachable")
        body = resp.read()
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.proxy()
        if self.path.split("?")[0] == "/data.json":
            try:
                with open(os.path.join(ROOT, "data", "data.json"), "rb") as f:
                    body = f.read()
            except OSError:
                return self.send_error(404, "no data.json yet")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        super().do_GET()

    def do_POST(self):
        self.proxy() if self.path.startswith("/api/") else self.send_error(404)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


def main():
    conf = read_env()
    data = os.path.join(ROOT, "data")
    env = dict(os.environ, DATA_FILE=f"{data}/data.json", OUT_FILE=f"{data}/data.json", INTERVAL="86400",
               PORT=str(API_PORT), TZ="Europe/Amsterdam", ADMIN_TOKEN=conf.get("ADMIN_TOKEN") or "test",
               SHEET_WRITE_URL=conf.get("SHEET_WRITE_URL", ""), SHEET_WRITE_SECRET=conf.get("SHEET_WRITE_SECRET", ""))
    if os.environ.get("CSV"):
        for name in TABS:
            path = os.path.join(ROOT, "testdata", f"{name.lower()}.csv")
            if os.path.exists(path):
                env[f"{name}_CSV"] = path
    print(f"admin password: {'from .env' if conf.get('ADMIN_TOKEN') else 'test'}; "
          f"saving to the Sheet: {'on' if env['SHEET_WRITE_URL'] and env['SHEET_WRITE_SECRET'] else 'off (no SHEET_WRITE_URL/SECRET in .env)'}")
    procs = [subprocess.Popen([sys.executable, "-u", os.path.join(ROOT, d, f"{d}.py")], env=env) for d in ("api", "sync")]
    try:
        print(f"site on http://localhost:{PORT}/  (log page: http://localhost:{PORT}/loggen/)", flush=True)
        http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
