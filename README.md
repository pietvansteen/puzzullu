# Puzzullu — puzzullu.funkyorbit.nl

De site van Puzzullu: al onze Jan van Haasteren-puzzels, wie welke doos heeft en hoe snel we ze gelegd hebben. Met statistieken, grappige feitjes en een generator die een willekeurige puzzel voor je kiest. Alles komt uit onze Google Sheet. De site haalt die één keer per dag op, en meteen als we een nieuwe tijd loggen.

## Hoe het werkt

```
Google Sheet ──(dagelijks, of meteen)──> sync ──> data/data.json ──┐
     ^                                                            ├──> web (nginx) ──> puzzullu.funkyorbit.nl
     └── Apps Script <── /loggen/ <── API ────────────────────────┘
```

| Map | Wat |
|---|---|
| `site/` | De website: `index.html` + `overzicht.js` (overzicht), `wat-is-nieuw/` (release notes), `shared.js`, `style.css`, `logo.svg`. Later ook `statistieken/`, `generator/` en `loggen/` |
| `sync/sync.py` | Haalt de tabbladen van de Sheet op als CSV en schrijft `data/data.json` |
| `api/api.py` | Kleine API achter het wachtwoord: de Sheet nu bijwerken, en (later) tijden loggen en de collectie aanpassen via de Apps Script |
| `web/nginx.conf` | Serveert de site en `data.json`, en stuurt `/api/` door naar de API |
| `tools/release.py` | Zet de nieuwste versie uit `site/changelog.json` in de footer en op de links naar css/js/svg |
| `tools/dev.py` | Draait de hele site lokaal, zoals op de server |
| `docker-compose.yml` | Draait alles met Docker Compose |

Er zijn geen pip-pakketten nodig: alles draait op standaard Python.

## Wat er uit de Sheet komt

Tot de migratie leest de sync de huidige tabbladen:

- **Puzzel Collectie 2.0**: één rij per keer gelegd (of per doos die nog niet gelegd is): naam (Engels en Nederlands), aantal stukjes, eigenaar, compleet, tijd, datum, gemaakt door, gefilmd, video-link.
- **Alle uitgaves JvH**: alle afbeeldingen met tekenaar, jaar en moeilijkheid (rating 1–5).
- **Voorronde/finale tijden**: de winnende tijden van het NK, voor de vergelijking na het loggen.

Na de migratie komen daar de nieuwe tabbladen **Afbeeldingen**, **Exemplaren**, **Logs** en **NK-tijden** voor in de plaats. Hun gid's komen dan in `docker-compose.yml`.

De Sheet moet gedeeld zijn als *Iedereen met de link kan bekijken*, en de tijdzone (*Bestand > Instellingen*) moet Europe/Amsterdam zijn.

## Draaien

```sh
git clone https://github.com/pietvansteen/puzzullu.git
cd puzzullu
cp .env.example .env    # en vul ADMIN_TOKEN, SHEET_WRITE_URL en SHEET_WRITE_SECRET in
sudo docker network create tunnel   # eenmalig, gedeeld met de Cloudflare Tunnel
docker compose up -d
```

De site staat dan lokaal op poort 8089. Na `git pull` staan wijzigingen in `site/` meteen live. Na wijzigingen in `sync.py`, `api.py` of `web/nginx.conf`: `docker compose restart sync api web` (`up -d` herstart een container niet als alleen de gekoppelde bestanden veranderd zijn). Na wijzigingen in `docker-compose.yml`: `docker compose up -d`.

### Cloudflare Tunnel

De site gebruikt de bestaande tunnel van funkyorbit.nl; Puzzullu heeft geen eigen cloudflared. Omdat de nginx-service van funkyorbit ook `web` heet, heeft de Puzzullu-webcontainer de vaste naam `puzzullu-web` en zit hij ook in het gedeelde netwerk `tunnel`:

1. Eenmalig: `sudo docker network create tunnel`.
2. In funkyorbit's `docker-compose.yml` komt de `tunnel`-service (cloudflared) ook in het netwerk `tunnel` (naast `default`).
3. In Cloudflare wijst de public hostname `puzzullu.funkyorbit.nl` naar `http://puzzullu-web:80`.

## Lokaal testen

```sh
python3 tools/dev.py
```

Dit serveert de site op http://localhost:8091 zoals nginx dat doet, en start de API en de sync tegen de live Sheet. Zonder `ADMIN_TOKEN` in `.env` is het wachtwoord `test`. Zonder internet of om niet steeds de Sheet op te halen: sla de tabbladen eenmalig op in `testdata/` en start met `CSV=1`:

```sh
python3 sync/sync.py --snapshot testdata
CSV=1 python3 tools/dev.py
```

De bestanden in `testdata/` staan niet in git, omdat ze onze namen en tijden bevatten.

## Versies en Wat is nieuw

Onderaan elke pagina staat de live versie met een link naar **Wat is nieuw** (`/wat-is-nieuw/`). De enige bron is `site/changelog.json`: nieuwste versie eerst, elk met een datum en een korte lijst wijzigingen in gewone taal.

Nummering `MAJOR.MINOR.PATCH`:

- **0.x**: alles vóór de complete site (overzicht, statistieken, generator, loggen). De complete site is **1.0.0**.
- **MAJOR**: een mijlpaal die de site flink verandert (bijvoorbeeld een nieuwe datastructuur).
- **MINOR**: nieuwe functies of zichtbare wijzigingen, gebundeld per werksessie.
- **PATCH**: bugfixes en kleine tekst- of stijlcorrecties.

**Eén versie per release.** Een release is alles wat samen live gaat met de volgende `git pull` op de server. Staat de bovenste versie nog niet live (kijk in de footer van de site), voeg dan regels toe aan die versie; anders komt er een nieuwe versie bovenaan. De datum is de dag dat hij live gaat.

Bij elke wijziging aan de site:

1. Pas `site/changelog.json` aan (zie hierboven).
2. Draai `python3 tools/release.py`. Dat zet de versie in de footer van elke pagina en `?v=<versie>-<code>` op de css/js/svg-links, zodat browsers en Cloudflare na elke wijziging de nieuwe bestanden ophalen.
3. Commit en push, en daarna `git pull` op de server.
