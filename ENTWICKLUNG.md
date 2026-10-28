# Eiweiß-Küche: Aufbau und Update-Ablauf

Für jede künftige Arbeit an der App. Erst lesen, dann ändern.

## Wo was liegt

| Was | Wo |
|---|---|
| Quellcode (dieser Ordner) | `D:\Instagram Content\eiweiss-kueche\` |
| GitHub-Repo (öffentlich) | https://github.com/jranglack-bot/eiweiss-kueche, Branch `main` |
| Live-App (GitHub Pages) | https://jranglack-bot.github.io/eiweiss-kueche/ |
| Garmin-Zwischenserver | Cloudflare Worker `eiweiss-garmin`, https://eiweiss-garmin.j-ranglack.workers.dev, Code in `garmin-worker/` |
| Recherche, Befund, Rohdaten | `D:\Instagram Content\Recherche\Ernaehrungs-App 2026-10-28\` (Befund.md), Rezepte: `Recherche\Rezepte Abnehmen 2026-10-27\` |
| BLS-Rohdatei (noch offen) | soll nach `Recherche\Ernaehrungs-App 2026-10-28\BLS\`, daraus `bls.json` und `basis-naehrwerte.json` in diesen Ordner |
| Testbilder für die Texterkennung | `test-bilder/` (nicht im Repo, steht in `.gitignore`) |

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Gerüst, gesamtes CSS, Reiterleiste, Content-Security-Policy (connect-src: Open Food Facts und der Garmin-Worker) |
| `app.js` | gesamte Logik, ein ES-Modul ohne Build-Schritt, Abschnitte mit `// ---------- Name ----------` |
| `data.js` | feste Daten: `BASIS` (Zutaten der eingebauten Rezepte mit Gang und Gramm je Einheit), `REZEPTE` (8 Rezepte mit `scharf` und Mild-Hinweis), `GAENGE`, `GRUNDREGELN` |
| `sw.js` | Service Worker: lädt alle Dateien beim Installieren, danach aus dem Speicher. `CACHE` hochzählen bei jeder Änderung |
| `manifest.webmanifest`, `icon-*.png` | App zum Startbildschirm. Symbole erzeugt mit einem Python-Skript ohne Zusatzpakete |
| `fonts/` | Atkinson Hyperlegible, Bricolage Grotesque, JetBrains Mono (selbst gehostet, OFL) |
| `vendor/` | barcode-detector 2.3.1 plus `zxing_reader.wasm` (Barcode ohne eingebauten Scanner), `vendor/ocr/` Tesseract 5.1.1 plus `deu.traineddata.gz` |
| `garmin-worker/` | `worker.js`, `wrangler.toml`, `ANLEITUNG.md` |

### Abschnitte in `app.js` (Reihenfolge)

Hilfen · Speicher · Nährwerte (BLS-Laden, Rezept-Nährwerte) · Rezepte · Gespeicherte Daten prüfen (`datenSauber`, bereinigt alles aus Speicher und Sicherung) · Garmin · Toast und Sheets (Bodenfenster mit Zurück-Taste über `history`) · Hauptansicht (Tagebuch, Monatskalender, Sportkarte) · Rezepte-Ansicht · Lebensmittel-Objekte · Menge eintragen · Suchen und Hinzufügen · Open Food Facts · Produkt anlegen oder ändern · Foto der Nährwerttabelle (Tesseract, Auswertung nach Zeilen und nach Lage) · Barcode-Scanner · Eigenes Rezept · Essensplan · Einkauf · Profil (Ziele, Zielrechner mit Reglern, Garmin, Version) · Ereignisse · Start (Service Worker, Update-Suche)

## Gespeicherte Daten (localStorage, Präfix `ek.`)

`ziele`, `profil`, `tagebuch` (je Datum eine Liste mit absoluten Nährwerten), `produkte` (gescannte und eigene, Schlüssel = Barcode), `rezepte` (eigene), `liste` (Einkauf: `rezepte`, `eigene`, `weg`, `anders`, `chk`), `zuletzt`, `plan` (je Datum geplante Rezepte), `garmin` (Adresse und Zugangscode, nicht in der Sicherung), `garminTage`, `tab`, `filter`, `log` (Fehlerprotokoll, sichtbar im Profil).

Neue Felder immer in `datenSauber` aufnehmen, sonst gehen sie beim nächsten Start verloren.

## Update-Ablauf

1. Ändern in diesem Ordner.
2. `VERSION` oben in `app.js` und `CACHE` in `sw.js` hochzählen (gleiche Nummer). Ohne das sehen installierte Apps die Änderung nicht.
3. `node --check app.js`
4. Lokal testen: Startkonfiguration `eiweiss-kueche` in `D:\Instagram Content\.claude\launch.json` (Port 8142), im Browser auf Handybreite 360 Pixel, hell und dunkel.
5. Hochladen:
   ```
   git -c safe.directory=* -c user.name=jranglack-bot -c user.email=294443298+jranglack-bot@users.noreply.github.com commit -am "…"
   git -c safe.directory=* -c "credential.helper=" -c "credential.helper=!gh auth git-credential" push
   ```
6. Warten, bis `https://jranglack-bot.github.io/eiweiss-kueche/app.js` die neue `VERSION` zeigt (meist unter 2 Minuten).
7. Am Handy: Profil, „Nach Updates suchen“. Die App prüft auch selbst beim Öffnen (höchstens alle 30 Minuten).

## Garmin-Worker

- Bereitstellen nach Änderung: im Ordner `garmin-worker` `npx wrangler deploy` (wrangler ist auf Julians Rechner mit seinem Cloudflare-Konto angemeldet).
- Geheimnisse `GARMIN_SCHLUESSEL` und `ZUGANG` (mindestens 12 Zeichen) trägt nur Julian ein, im Cloudflare-Dashboard: Workers & Pages, eiweiss-garmin, Settings, Variables and Secrets, „Add“.
- Schnittstelle laut github.com/garmin/connect-personal-api-python: Token per `POST /personalapitoken-service/personal-api/personal-api-key/token` (Kopf `ApiKey …`, Antwort ist das JWT als Text), Aktivitäten `/activitylist-service/activities/search/activities`, Tageswerte `/usersummary-service/v2/dailysummaries`.
- Originaldaten ansehen: Variable `DEBUG=1` setzen, `?datum=…&roh=1` mit Kopf `X-Zugang`, danach `DEBUG` löschen.

## Bekannte Eigenheiten

- Open Food Facts: Barcode-Abfrage ist stabil, die Textsuche (`cgi/search.pl`) drosselt schnell und antwortet dann ohne CORS.
- Tesseract liest „5,2g“ als „5,29“ und „19 g“ als „199g“, kcal kommt manchmal aus der Portionsspalte. `wertAusWort` und der kJ-Abgleich in `naehrwerteAusText` fangen das ab.
- Lose Lebensmittel und die Nährwerte der 8 Rezepte brauchen die BLS-Datei. Bis dahin zeigen die Rezepte „Nährwerte folgen“.
