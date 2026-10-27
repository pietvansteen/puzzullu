# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

puzzullu.funkyorbit.nl: the website of Puzzullu, a group that does Jan van Haasteren (JvH) jigsaw puzzles and keeps their times. It shows every puzzle, who owns which box and who did it in what time, statistics and fun facts, a random-puzzle generator, and a password-protected page to log times and update the collection. All data lives in a Google Sheet (*Jan van Haasteren Puzzel Collectie 3.0*). The site is **Dutch only** and **always dark** (navy, after the logo).

The full specification is `SPEC.local.md` (gitignored, so it may be missing in a fresh clone). It follows the same architecture as `pietvansteen/funkyorbit`.

No build step and no dependencies: vanilla JS/CSS/HTML in `site/`, Python standard library only (no pip), Docker Compose for hosting.

## Commands

Save the Sheet tabs as CSV in `testdata/` (gitignored), then build `data/data.json` from them (one-shot with `INTERVAL=0`; without the `*_CSV` vars it downloads the live Sheet):

```sh
python3 sync/sync.py --snapshot testdata
COLLECTIE_CSV=testdata/collectie.csv UITGAVES_CSV=testdata/uitgaves.csv NK_CSV=testdata/nk.csv \
  OUT_FILE=data/data.json INTERVAL=0 python3 sync/sync.py
```

Serving the site locally: `python3 tools/dev.py` (or the `puzzullu` entry in `.claude/launch.json`) serves http://localhost:8091 like nginx does (`/data.json`, `/api/` proxied to the API on port 8001), and starts the API and the sync against the live Sheet (`CSV=1` for `testdata/`). It reads `.env` (gitignored); without `ADMIN_TOKEN` the password is `test`.

After **every** change under `site/`:

```sh
python3 tools/release.py
```

There are no tests or linters. Verify in a browser.

Production: `docker compose up -d` (services `web` nginx, container `puzzullu-web`, port 8089; `sync`; `api`). Secrets `ADMIN_TOKEN`, `SHEET_WRITE_URL`, `SHEET_WRITE_SECRET` live in `.env` on the server only (`.env.example` lists them). Deploy = push to GitHub, then the owner runs `git pull` on the server: `site/` changes are live at once; changes to `sync.py`, `api.py` or `nginx.conf` need `sudo docker compose restart sync api web`; changes to `docker-compose.yml` need `sudo docker compose up -d`. The Sheet's time zone must be Europe/Amsterdam.

Hosting goes through funkyorbit's existing Cloudflare Tunnel: its cloudflared joins the external Docker network `tunnel`, and the public hostname points to `http://puzzullu-web:80` (not `http://web:80`, which is funkyorbit's nginx). Puzzullu has no cloudflared or `TUNNEL_TOKEN` of its own.

## Architecture

```
Google Sheet ──CSV──> sync/sync.py (daily, or at once on data/sync-now) ──> data/data.json ──> nginx ──> site/ pages
     ^                     └─ daily JvH scrape (step 2)                             └──> api/api.py (/api/)
     └── apps-script/Puzzullu.gs (web app, step 4) <── POST /api/... (api.py, password) ── writes data/sync-now
```

- **sync/sync.py** fetches the Sheet tabs by gid (defaults in `sync.py`, overridable via `docker-compose.yml`; `<NAME>_CSV` env vars read a local file instead). Two layouts give the same `data.json`:
  - **old** (now): `Puzzel Collectie 2.0` (one row per log or per box), `Alle uitgaves JvH` (titles, artist, year, rating; header on row 3) and `Voorronde/finale tijden` (NK times). Names are matched loosely (`name_key`); unmatched names become their own puzzle until the migration.
  - **new** (after the migration, when `AFBEELDINGEN_GID`, `EXEMPLAREN_GID` and `LOGS_GID` are set): tabs `Afbeeldingen`, `Exemplaren`, `Logs`, `NK-tijden`, columns matched by name as in the spec.
  - `data.json` keys: `updated, layout, afbeeldingen` (id, en, nl, tekenaar, jaar, rating, bron, jvhUrl, opmerking), `exemplaren` (id, afbeelding, stukjes, eigenaar, volgnummer, missend, weg), `logs` (id, exemplaar, sec, datum ISO, makers sorted, missend, gefilmd, video; oldest first), `nk` (puzzel, afbeelding, jaar, sec, categorie, ronde), `personen`. Written atomically; when nothing can be read the old file stays. The sync-now file may hold `{"log": "<id>"}`: the sync retries until that log is in Google's CSV export.
- **api/api.py**: `GET /api/health`, `GET /api/auth`, `POST /api/sync`. Admin calls need `Authorization: Bearer <ADMIN_TOKEN>`; wrong passwords are limited to 10 per address per 15 minutes. The write actions to the Apps Script come in step 4.
- **site/shared.js** (`window.PZ`): `esc`, `getal`, `tijd` (seconds → `u:mm:ss`), `datum` (ISO → `dd-mm-jjjj`), `sterren`, `data()` (cached fetch of `/data.json`). Each page has its own folder and script; the overview is `/` (`overzicht.js`), release notes `/wat-is-nieuw/` (renders `changelog.json`). Still to come: `/statistieken/`, `/generator/`, `/loggen/` (admin, noindex, "Loggen" in the menu only on devices with the password in `localStorage`).
- `site/logo.svg` is a placeholder until the real logo arrives; it is also the favicon.

## Domain rules (easy to get wrong)

- **Afbeelding** = one puzzle picture, shown once in the overview. **Exemplaar** = one physical box: afbeelding + pieces + owner (+ volgnummer when an owner has the same version twice). **Versie** = afbeelding + pieces. **Log** = one time a box was done.
- An owner is always **one** owner: a person, or `Lau & Dix` (counts as one). `Puzzullu` is no longer an owner (the old layout maps it to no owner). A box without an owner only exists when it was done.
- Boxes that are gone (`status = weg`, old layout: "Verkocht!" in the last column) stay, so their logs stay valid. Logs are never changed or removed when a box changes owner.
- A **team** is exactly the same set of makers, in any order. NK comparison only when the number of makers equals the NK category: solo 1, duo 2, team 4.
- Combo boxes (`Combidoos`) are registered as separate boxes per picture; derived editions (*In de drukte!*) are their own picture.
- Times are `u:mm:ss` on the site and seconds in `data.json`; dates `dd-mm-jjjj` on the site (the Sheet has `d-m-jjjj`, both are read) and ISO in `data.json`. Yes/no is read loosely (`"Nee "`).
- Never overwrite hand-made fields (`rating`, `opmerking`, cleaned-up names) from the JvH scrape. Names in the Sheet are only cleaned up after Piet confirms.

## Releases and caching

`site/changelog.json` is the single source for the version. `tools/release.py` writes the footer `vX.Y.Z · Wat is nieuw` and the `?v=<version>-<hash>` on every css/js/svg link in `site/**/*.html`. Cloudflare caches css/js/svg for hours, so never hand-edit these or skip the script.

- One version per release, and a release is whatever goes live with the owner's next `git pull`. Before editing the changelog, check the live footer: `curl -4 -s https://puzzullu.funkyorbit.nl/ | grep 'class="version"'`. If the top version in `changelog.json` is already live, start a new one; otherwise add lines to it.
- Add a changelog line (Dutch, plain language) for every visible change; the version's date is the day it goes live.
- Numbering: `0.x` until the complete site (overview, statistics, generator, logging) which is `1.0.0`; MAJOR for a milestone that changes the site substantially, MINOR for new features or visible changes bundled per work session, PATCH for bug fixes and small text or style corrections.

## Build order

1. Repo, docs, Docker Compose, `tools/dev.py`, `tools/release.py`, sync reading the Sheet → `0.1.0` (done)
2. JvH scraper + migration report → Piet confirms the names → migration → `0.2.0`
3. Overview page → `0.3.0`
4. Apps Script `Puzzullu.gs` + `api.py` write actions + Loggen & beheer → `0.4.0`
5. Generator → `0.5.0`
6. Statistics + NK comparison → `0.6.0`
7. Design finishing, logo → `1.0.0`
8. Deploy on the NAS

## Other notes

- Keep the public README and this file free of host details (server model, paths, IPs, tokens). Private setup notes go in `*.local.md`, which is gitignored. The Sheet data (names, times) is not committed either: `testdata/*.csv` is gitignored.
- Work comes from GitHub issues on `pietvansteen/puzzullu`; reference them with `Closes #n` in commits. The tunnel change in funkyorbit's `docker-compose.yml` is an issue/commit in `pietvansteen/funkyorbit`.
