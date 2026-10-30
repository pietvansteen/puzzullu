# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

puzzullu.funkyorbit.nl: the website of Puzzullu, a group that does Jan van Haasteren (JvH) jigsaw puzzles and keeps their times. It shows every puzzle, who owns which box and who did it in what time, statistics and fun facts, a random-puzzle generator, and a password-protected page to log times and update the collection. All data lives in a Google Sheet (*Jan van Haasteren Puzzel Collectie 3.0*). The site is **Dutch only** and **always dark** (navy).

The full specification is `SPEC.local.md` (gitignored, so it may be missing in a fresh clone). It follows the same architecture as `pietvansteen/funkyorbit`.

No build step and no dependencies: vanilla JS/CSS/HTML in `site/`, Python standard library only (no pip), Docker Compose for hosting.

## Commands

Save the Sheet tabs as CSV in `testdata/` (gitignored), then build `data/data.json` from them (one-shot with `INTERVAL=0`; without the `*_CSV` vars it downloads the live Sheet):

```sh
python3 sync/sync.py --snapshot testdata
AFBEELDINGEN_CSV=testdata/afbeeldingen.csv EXEMPLAREN_CSV=testdata/exemplaren.csv LOGS_CSV=testdata/logs.csv \
  NK_CSV=testdata/nk.csv OUT_FILE=data/data.json INTERVAL=0 python3 sync/sync.py
```

The migration (step 2) was done on 28-10-2026: `tools/migratie.py` turned the old tabs (saved in `migratie/oud/`) into the new ones, with Piet's choices in `migratie/keuzes.csv` and `migratie/correcties.json`, and wrote `migratie/rapport.html`. `migratie/` is gitignored. The script stays for reference; the Sheet is now the source.

Serving the site locally: `python3 tools/dev.py` (or the `puzzullu` entry in `.claude/launch.json`) serves http://localhost:8091 like nginx does (`/data.json`, `/api/` proxied to the API on port 8001), and starts the API and the sync against the live Sheet (`CSV=1` for `testdata/`). It reads `.env` (gitignored; the environment wins); without `ADMIN_TOKEN` the password is `test`. `MOCK=1` (launch entry `puzzullu-mock`) tests `/loggen/` without the real Sheet: CSV mode plus `tools/mock_sheet.py` as the Apps Script, writing to `testdata/` (password `test`). Afterwards restore with `python3 sync/sync.py --snapshot testdata`.

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
     ^                     └─ daily JvH catalogue (sync/jvh.py -> data/jvh.json)    └──> api/api.py (/api/)
     └── apps-script/Puzzullu.gs (web app) <── POST /api/... (api.py, password, from /loggen/) ── writes data/sync-now
```

- **sync/sync.py** fetches the Sheet tabs by gid (defaults in `sync.py`, overridable via `docker-compose.yml`; `<NAME>_CSV` env vars read a local file instead). Two layouts give the same `data.json`:
  - **old** (before the migration; only read when `COLLECTIE_GID` is set): `Puzzel Collectie 2.0` (one row per log or per box), `Alle uitgaves JvH` (titles, artist, year, rating; header on row 3) and `Voorronde/finale tijden` (NK times). Names are matched loosely (`name_key`); unmatched names become their own puzzle until the migration.
  - **new** (now): tabs `Afbeeldingen`, `Exemplaren`, `Logs`, `NK-tijden` (and `Personen`, not read by the sync), columns matched by name as in the spec. When one of them can't be read, the old `data.json` stays.
  - Once a day (or at once with `{"jvh": true}` in sync-now) it fetches the JvH catalogue with **sync/jvh.py** into `data/jvh.json`: every picture of *lijst alle afbeeldingen*, plus titles of *lijst alle puzzels* that are not in it (bron `jvh-puzzels`), without combo boxes, each with its piece counts (`versies`). Fail-safe: fewer than 250 pictures or 800 puzzles = the page broke, the old file stays. Once a week (or with `{"jvh": true}`, after the sync so a new log never waits) `jvh.namen()` reads each list-1 picture's detail page (about 320 pages, one at a time) for the names of all products based on it, into `data/jvh-namen.json`. `build` adds `versies`, `jvhUrl`, `namen` (other names) and `verwant` (ids of pictures whose title is one of those names, both ways) to the Sheet's pictures and logs the JvH pictures the Sheet does not have yet (writing them to the Sheet comes with the Apps Script, step 4).
  - `data.json` keys: `updated, layout, afbeeldingen` (id, en, nl, tekenaar, jaar, rating, bron, jvhUrl, opmerking, versies, namen, verwant), `exemplaren` (id, afbeelding, stukjes, eigenaren (list), volgnummer, missend (null = pieces missing, number unknown), weg), `logs` (id, exemplaar, sec (null when done without a time), datum ISO, makers sorted, missend (null = not complete, number unknown), gefilmd, video, ingevoerd (`ingevoerd_op` as `2026-10-28T14:09`, null for logs from before the site); oldest first), `nk` (puzzel, afbeelding, jaar, sec, categorie, ronde, stukjes), `personen`. Written atomically; when nothing can be read the old file stays. The sync-now file may hold `{"log": "<id>"}`: the sync retries until that log is in Google's CSV export.
- **api/api.py**: `GET /api/health`, `GET /api/auth`, `POST /api/sync`, `POST /api/jvh` (sync plus the JvH catalogue now), and the write actions `POST /api/log`, `/api/exemplaar`, `/api/exemplaar/weg`, `/api/missend`, `/api/video`, `/api/rating`. Admin calls need `Authorization: Bearer <ADMIN_TOKEN>`; wrong passwords are limited to 10 per address per 15 minutes. A write action is checked, sent to the Apps Script (`SHEET_WRITE_URL` + `SHEET_WRITE_SECRET`, with the body's random `id` so a retry is not saved twice), and then writes sync-now `{"wacht": {"lijst", "id", "veld"?, "waarde"?}}`: the sync retries (8 × 5 s) until `data.json` shows that change. Error messages are Dutch and go to the page as they are.
- **apps-script/Puzzullu.gs**: one `doPost` with `action` (`addLog`, `addExemplaar`, `removeExemplaar` → status `weg`, `setMissing`, `setVideoUrl`, `setRating`, `addAfbeeldingen`), secret check, script lock and a 10-minute cache per request id. Columns are found by header name; IDs (`L0535`, `<afbeelding>-<stukjes>-<eigenaren>[-<volgnummer>]`) and dates are made there; new names go to `Personen`. Pasted by hand into the Sheet (see README); after a change: *Manage deployments > New version*. The sync uses `addAfbeeldingen` to add new JvH pictures when `SHEET_WRITE_URL` is set.
- **site/shared.js** (`window.PZ`): `esc`, `getal`, `tijd` (seconds → `u:mm:ss`), `datum` (ISO → `dd-mm-jjjj`), `sterren`, `data()` (cached fetch of `/data.json`). Each page has its own folder and script; the overview is `/` (`overzicht.js`: totals, then every picture once in three `<details>` levels picture > versions (piece count, with all its boxes) > all times of that version, with search (titles first, then `namen` with a note "ook: …", then `verwant` pictures "verwant aan …"), chip filters for pieces/difficulty (1–5 stars or "Zonder rating")/owner/makers/group size (Solo, Duo, Drie, Team = 4, 5 of meer; makers with more than 5 logs first, the rest behind "Meer namen"; "Samen" (default; hidden when the chosen group sizes can never hold all chosen makers) or "minstens één"), sorting (alphabetical; by date: the most recent date of the shown logs, newest or oldest first, with "laatst gemaakt op" under the name and undated puzzles last; by count: most or least), a two-handle time slider (with "Alleen de snelste tijd per versie telt": the slider then tests the best time per version, and with a lower bound also keeps versions not done yet), view checkboxes (rating on by default) and a "Laat alle tijden zien" button that opens every picture and version in the list; settings except the search term are kept in `localStorage` key `pz-overzicht-v4`), release notes `/wat-is-nieuw/` (renders `changelog.json`; `[word](/page/)` in a line is a link, and a link to `/loggen/` looks like plain text: that is the hidden way to the log page, the word "pagina" in the 0.4.0 notes), and `/loggen/` (`loggen.js`, noindex: password once per device in `localStorage` key `pz_admin` via `PZ.admin`, then "Loggen" in the menu; tabs Tijd loggen (on top the last log entered, highest id, with when it was entered and its name linking to `jvhUrl`; afterwards: the difference with the previous time and records, both on the same version and the same number of people; the NK comparison only with as many people as the category and the same piece count, column `stukjes` in NK-tijden), Dozen (add, missing pieces, gone), Video's (gefilmd without link), Rating, Overig (sync now, JvH now, log out)). `/generator/` (`generator.js`): picks one random box we own (not `weg`), with chip filters owner (any of them), pieces, difficulty and "nog niet gemaakt door" (per version, on any box: with 2+ names "Samen" (default) = never all of them in one log, as on the overview, or "Geen van hen"), remembered in `localStorage` key `pz-generator-v1`; on devices with the password a button opens `/loggen/?doos=<exemplaar id>`, which preselects that box. `/statistieken/` (`statistieken.js`, all computed in the browser from `data.json`): tiles, a random fun fact, per year, per person (a log counts for each maker), per owner and per piece count, most done versions, videos; a person/team dropdown (exact set of makers with at least 3 timed logs, kept in `localStorage` key `pz-stats-team`) with progress on 500 or 1000 pieces (chips, kept in `localStorage` key `pz-stats-stukjes`; SVG chart, average of the last 5, first 5 against last 5 when there are at least 5) and the comparison with every other team of the same size on shared versions (best time each, geometric mean of the ratios); versions with at least 3 timed logs; and the NK table (our best with as many people as the category and the same piece count, against the winner).
- The site installs as a web app: `site/manifest.webmanifest` (start `/`, standalone, navy) and `site/icons/` (192, 512, maskable 512 with extra margin, apple-touch-icon 180), made from `logo.svg` with macOS `qlmanage -t -s 1024` + `sips -z`; every page links them in its `<head>`. No service worker (Chrome no longer needs one to install). Remake the icons when the logo changes.
- `site/logo.svg` is the temporary logo from Piet (white piece and letters on `#2a3c9a`); it is also the favicon. The site keeps its own darker navy (`--paper: #0f1f3f`), which Piet prefers over the logo's blue. The background pieces are the logo's piece in a data URI in `style.css`, each with its own size and rotation.

## Domain rules (easy to get wrong)

- **Afbeelding** = one puzzle picture, shown once in the overview. **Exemplaar** = one physical box: afbeelding + pieces + owner (+ volgnummer when an owner has the same version twice). **Versie** = afbeelding + pieces. **Log** = one time a box was done.
- A box has **one or more** owners (column `eigenaar`, comma-separated like the makers: `Dixie, Lauren`) and always counts as **one** box; per person it counts for each owner. There are no group persons (the old layout's `Lau & Dix` becomes Dixie and Lauren). `Puzzullu` is no longer an owner (the old layout maps it to no owner). A box without an owner only exists when it was done.
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
2. JvH scraper + migration report → Piet confirms the names → migration → `0.2.0` (done)
3. Overview page → `0.3.0` (done)
4. Apps Script `Puzzullu.gs` + `api.py` write actions + Loggen & beheer → `0.4.0` (done; the Apps Script is set up by hand)
5. Generator → `0.5.0` (done)
6. Statistics + NK comparison → `0.6.0` (done; went live together with 0.5.0)
7. Design finishing → `1.0.0` (done; Piet keeps the current logo and house style)
8. Deploy on the NAS

## Other notes

- Keep the public README and this file free of host details (server model, paths, IPs, tokens). Private setup notes go in `*.local.md`, which is gitignored. The Sheet data (names, times) is not committed either: `testdata/*.csv` is gitignored.
- Work comes from GitHub issues on `pietvansteen/puzzullu`; reference them with `Closes #n` in commits. The tunnel change in funkyorbit's `docker-compose.yml` is an issue/commit in `pietvansteen/funkyorbit`.
