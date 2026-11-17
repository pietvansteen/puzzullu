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
| `site/` | De website: `index.html` + `overzicht.js` (overzicht), `statistieken/` (in tabbladen, met records-muur en kalender), `persoon/` (eigen pagina per puzzelaar: weekreeks, jaaroverzicht, badges), `generator/`, `loggen/`, `wat-is-nieuw/` (release notes), `shared.js`, `rekenen.js` (gedeelde berekeningen en de voorspelling), `badges.js`, `style.css`, `logo.svg` |
| `sync/sync.py` | Haalt de tabbladen van de Sheet op als CSV en schrijft `data/data.json` |
| `sync/nk.py` | Leest één keer per dag de uitslagen van afgelopen NK-wedstrijden op nklegpuzzelen.nl, en zet nieuwe winnende tijden in het tabblad NK-tijden (via de Apps Script) |
| `sync/jvh.py` | Haalt één keer per dag de JvH-catalogus op (alle afbeeldingen en alle uitgaves) uit het digitaal museum van jvh-puzzels.nl |
| `tools/migratie.py` | Eenmalig (gedaan op 28-10-2026): zette de oude tabbladen om naar de nieuwe, met een rapport om eerst te controleren |
| `api/api.py` | Kleine API achter het wachtwoord: tijden loggen, dozen, video-links en ratings opslaan via de Apps Script, en de Sheet nu ophalen |
| `apps-script/Puzzullu.gs` | Apps Script in de Sheet: schrijft wat er op `/loggen/` wordt opgeslagen in de tabbladen |
| `web/nginx.conf` | Serveert de site en `data.json`, en stuurt `/api/` door naar de API |
| `tools/release.py` | Zet de nieuwste versie uit `site/changelog.json` in de footer en op de links naar css/js/svg |
| `tools/dev.py` | Draait de hele site lokaal, zoals op de server |
| `tools/mock_sheet.py` | Neppe Apps Script voor lokaal testen van `/loggen/` (`MOCK=1 python3 tools/dev.py`) |
| `docker-compose.yml` | Draait alles met Docker Compose |

Er zijn geen pip-pakketten nodig: alles draait op standaard Python.

## Wat er uit de Sheet komt

- **Afbeeldingen**: elke puzzelplaat één keer, met Engelse en Nederlandse naam, tekenaar, jaar, moeilijkheid (rating 1–5) en de link naar jvh-puzzels.nl.
- **Exemplaren**: elke doos: welke afbeelding, hoeveel stukjes, van wie (één of meer eigenaren), hoeveel stukjes er missen en of hij weg is.
- **Logs**: elke keer dat we een doos gelegd hebben: tijd, datum, wie, compleet, gefilmd en video-link.
- **NK-tijden**: de winnende tijden van het NK, voor de vergelijking na het loggen. Nieuwe uitslagen zet de sync er zelf in.
- **Personen**: alle namen, voor de keuzelijsten.

Hun gid's staan in `docker-compose.yml`. De oude tabbladen (*Puzzel Collectie 2.0*, *Alle uitgaves JvH*, *Voorronde/finale tijden*) zijn op 28-10-2026 overgezet met `tools/migratie.py` en worden niet meer gelezen.

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

## Loggen & beheer

De pagina `/loggen/` staat niet in het menu voor bezoekers. Je logt één keer in met het wachtwoord uit `ADMIN_TOKEN` (`.env`); daarna onthoudt dat apparaat het en staat **Loggen 🔒** in het menu. Daar kun je:

- **Tijd loggen**: puzzel en doos kiezen, wie, de tijd, de datum, compleet of niet, gefilmd. Zodra puzzel en mensen gekozen zijn, staat er een voorspelling van de tijd. Daarna zie je of het een record is, hoe de tijd zich verhoudt tot de voorspelling en tot de winnaar van het NK (alleen als het aantal mensen klopt: solo 1, duo 2, team 4), en welke nieuwe badges er gehaald zijn.
- **Dozen**: een doos toevoegen (heeft dezelfde eigenaar die versie al, dan wordt het doos 2), missende stukjes aanpassen of een doos weghalen. Een weggehaalde doos blijft in de Sheet met status `weg`, zodat de tijden blijven bestaan.
- **Video's**: een YouTube-link toevoegen bij gefilmde puzzels.
- **Rating**: de moeilijkheid (1–5) van een puzzel. Dat kan ook rechtstreeks in de Sheet, in tabblad Afbeeldingen, kolom `rating`.
- **Overig**: de Sheet of de JvH-catalogus nu ophalen, en uitloggen.

Opslaan gaat via een Apps Script in de Sheet. Eenmalig instellen:

1. In de Sheet: *Extensies > Apps Script*, voeg een scriptbestand toe (*+ > Script*) met de naam `Puzzullu` en plak daar `apps-script/Puzzullu.gs` in. Het project mag geen andere `doPost` hebben.
2. *Projectinstellingen > Scripteigenschappen*: voeg `SECRET` toe met een lange willekeurige waarde.
3. *Implementeren > Nieuwe implementatie*, type *Web-app*, uitvoeren als *Ik*, toegang *Iedereen*. Geef de toegang die gevraagd wordt en kopieer de `/exec`-URL.
4. Zet `SHEET_WRITE_URL` (de URL) en `SHEET_WRITE_SECRET` (hetzelfde geheim) in `.env` op de server en draai `sudo docker compose up -d`.

Na een wijziging in `Puzzullu.gs`: *Implementeren > Implementaties beheren*, bewerken, *Nieuwe versie*; de URL blijft hetzelfde.

Met de Apps Script voegt de sync ook nieuwe puzzels van de JvH-site toe aan het tabblad Afbeeldingen, en nieuwe NK-uitslagen van nklegpuzzelen.nl aan het tabblad NK-tijden (één keer per dag; nooit dubbel, ook niet als de puzzel in de Sheet een andere naam heeft).

## Meldingen

Op de statistieken (bij Laatst gemaakt) kan iedereen op zijn eigen apparaat meldingen aanzetten: zodra de sync een nieuwe tijd in de Sheet ziet, krijgt elk aangemeld apparaat een melding, behalve het apparaat dat de tijd zelf logde. Er is niets in te stellen: de sync maakt de sleutels de eerste keer zelf (`data/vapid.json`), en de aanmeldingen staan in `data/push.json`. Op de iPhone werkt het alleen als Puzzullu op het beginscherm staat (iOS 16.4 of nieuwer).

## Veiligheid

- **Geen open poorten.** De site is alleen via de Cloudflare Tunnel bereikbaar; die maakt zelf een verbinding naar buiten. De tunnel stuurt alleen door naar de webserver (nginx), niet naar de rest van de NAS.
- **De site zelf is alleen lezen.** nginx serveert vaste bestanden en `data.json`; de mappen zijn read-only in de containers.
- **De API kan maar zes dingen**: een tijd, een doos, een doos weg, missende stukjes, een video-link en een rating. Elke invoer wordt streng gecontroleerd (vaste formaten voor tijd, datum, ID's en aantallen, namen zonder komma's en nooit beginnend met `= + - @`, video-links alleen naar YouTube: `youtube.com` of `youtu.be`, via `https://`; ook de site linkt alleen daarnaar). Er wordt nooit iets van de invoer uitgevoerd: geen shell, geen `eval`, geen database, geen uploads.
- **Wachtwoord**: `ADMIN_TOKEN`, vergeleken in constante tijd; na 10 foute pogingen per adres een kwartier niets.
- **Schrijven gebeurt bij Google, niet op de NAS.** De API stuurt een actie naar de Apps Script met een geheime sleutel (`SHEET_WRITE_SECRET`); de Apps Script kent alleen die zeven acties en kan geen rijen wissen.
- **Gegevens uit de Sheet zijn tekst.** De sync leest de Sheet als CSV (formules worden niet uitgevoerd, alleen hun uitkomst als tekst), en de site toont alle tekst ge-escaped, dus een naam of titel kan geen code op de pagina worden.
- **Geheimen staan alleen in `.env` op de server**, niet in git.
- **Meldingen** (Up-to-date blijven): aanmelden kan zonder wachtwoord, maar de server bewaart alleen het adres dat de browser geeft, en alleen als dat bij een pushdienst van Google, Mozilla, Apple of Microsoft hoort. Naar andere adressen stuurt de server nooit iets. Hooguit 500 apparaten en 30 aanmeldingen per uur per adres. Een melding is leeg ("er is iets nieuws"); de telefoon haalt zelf `data.json` op. De sleutels (`data/vapid.json`) maakt de sync zelf en worden niet door nginx geserveerd.

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

De loggen-pagina testen zonder de echte Sheet: `MOCK=1 python3 tools/dev.py` (wachtwoord `test`). Een neppe Apps Script (`tools/mock_sheet.py`) schrijft dan in `testdata/`; zet die daarna terug met `python3 sync/sync.py --snapshot testdata`.

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
