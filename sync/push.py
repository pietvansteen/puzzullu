"""
Web push without payload, standard library only: "there is something new", after which the service worker
(site/sw.js) fetches /data.json itself and shows the newest log. Without a payload nothing has to be encrypted;
only the VAPID signature (ES256: ECDSA on P-256 with SHA-256) is needed, which is done here in plain Python.

Files next to data.json (the API writes the first two, the sync reads them):
  push.json       {"abonnees": [{"endpoint", "sinds"}]}  devices that want a message
  push-stil.json  {"<log id>": {"e": endpoint, "t": time}}  the device that logged it gets no message about it
  vapid.json      {"d", "x", "y"}                        the server's key pair, made once (never served by nginx)
All three are changed under an flock on push.lock, so the API and the sync never overwrite each other.
"""

import base64
import fcntl
import hashlib
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager

# ---------------------------------------------------------------- P-256

P = 2**256 - 2**224 + 2**192 + 2**96 - 1
A = P - 3
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def _add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    if p[0] == q[0] and (p[1] + q[1]) % P == 0:
        return None
    if p == q:
        lam = (3 * p[0] * p[0] + A) * pow(2 * p[1], -1, P) % P
    else:
        lam = (q[1] - p[1]) * pow(q[0] - p[0], -1, P) % P
    x = (lam * lam - p[0] - q[0]) % P
    return x, (lam * (p[0] - x) - p[1]) % P


def _mul(k, point=G):
    result = None
    while k:
        if k & 1:
            result = _add(result, point)
        point = _add(point, point)
        k >>= 1
    return result


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(d, message):
    """ES256 signature (r || s, 64 bytes) of message with private key d."""
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    while True:
        k = secrets.randbelow(N - 1) + 1
        r = _mul(k)[0] % N
        s = pow(k, -1, N) * (z + r * d) % N
        if r and s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def verify(x, y, message, sig):
    """Check an ES256 signature (only used to test sign())."""
    r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
    if not (0 < r < N and 0 < s < N):
        return False
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    w = pow(s, -1, N)
    point = _add(_mul(z * w % N), _mul(r * w % N, (x, y)))
    return point is not None and point[0] % N == r


# ---------------------------------------------------------------- files

# only the push services of the browsers, so the server never sends requests anywhere else
PUSH_HOSTS = re.compile(r"^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com"
                        r"|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$")


def valid_endpoint(url):
    if not isinstance(url, str) or len(url) > 1000:
        return False
    try:
        u = urllib.parse.urlsplit(url)
        return (u.scheme == "https" and not u.username and not u.password and u.port is None
                and bool(PUSH_HOSTS.match(u.hostname or "")) and len(u.path) > 1)
    except ValueError:
        return False


@contextmanager
def locked(folder):
    with open(os.path.join(folder, "push.lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def read(folder, name, empty):
    try:
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, type(empty)) else empty
    except (OSError, ValueError):
        return empty


def write(folder, name, value):
    path = os.path.join(folder, name)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(path + ".tmp", path)


def keys(folder):
    """The server's VAPID key pair; made the first time."""
    with locked(folder):
        k = read(folder, "vapid.json", {})
        if not all(isinstance(k.get(c), int) for c in "dxy"):
            d = secrets.randbelow(N - 1) + 1
            x, y = _mul(d)
            k = {"d": d, "x": x, "y": y}
            write(folder, "vapid.json", k)
    return k


def public_key(k):
    return b64url(b"\x04" + k["x"].to_bytes(32, "big") + k["y"].to_bytes(32, "big"))


# ---------------------------------------------------------------- sending

def send(endpoint, k, subject, timeout=10):
    """One empty push message; returns the HTTP status (201 = delivered to the push service)."""
    u = urllib.parse.urlsplit(endpoint)
    head = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = b64url(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600,
                                "sub": subject}).encode())
    jwt = f"{head}.{claims}"
    jwt += "." + b64url(sign(k["d"], jwt.encode()))
    req = urllib.request.Request(endpoint, data=b"", method="POST", headers={
        "TTL": str(24 * 3600), "Urgency": "normal", "Content-Length": "0",
        "Authorization": f"vapid t={jwt}, k={public_key(k)}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def notify(folder, new_ids, subject, log=print):
    """Tell every device about new logs, except a device that made all of them itself.
    Devices the push service no longer knows (404/410) are removed."""
    k = keys(folder)
    with locked(folder):
        subs = read(folder, "push.json", {}).get("abonnees", [])
        stil = read(folder, "push-stil.json", {})
        # forget the entries for these logs, and any older than a day (a log the sync never saw)
        cutoff = time.time() - 24 * 3600
        write(folder, "push-stil.json", {i: v for i, v in stil.items() if i not in new_ids
                                          and isinstance(v, dict) and v.get("t", 0) > cutoff})
    makers = {(stil.get(i) or {}).get("e") for i in new_ids} if isinstance(stil, dict) else {None}
    own = next(iter(makers)) if len(makers) == 1 else None
    dead, sent = set(), 0
    for sub in subs:
        e = sub.get("endpoint")
        if not valid_endpoint(e) or (own and e == own):
            continue
        try:
            status = send(e, k, subject)
        except (urllib.error.URLError, OSError) as err:
            log(f"push: {urllib.parse.urlsplit(e).hostname} not reached: {err}")
            continue
        if status in (404, 410):
            dead.add(e)
        elif 200 <= status < 300:
            sent += 1
        else:
            log(f"push: {urllib.parse.urlsplit(e).hostname} answered {status}")
    if dead:
        with locked(folder):
            data = read(folder, "push.json", {})
            data["abonnees"] = [s for s in data.get("abonnees", []) if s.get("endpoint") not in dead]
            write(folder, "push.json", data)
    log(f"push: {len(new_ids)} new log(s), sent to {sent} device(s)" + (f", {len(dead)} removed" if dead else ""))
