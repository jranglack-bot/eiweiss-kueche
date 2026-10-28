# Eiweiß-Küche

Private Ernährungs-App für das Handy: Tagebuch mit Tageszielen, Barcode-Scanner, eigene Produkte, Rezepte mit Nährwerten und Einkaufsliste. Läuft im Browser, lässt sich zum Startbildschirm hinzufügen und funktioniert offline.

**App:** https://jranglack-bot.github.io/eiweiss-kueche/

## Daten

- Alle Einträge liegen nur auf dem Gerät (localStorage). Sicherung im Profil als JSON-Datei.
- Nach außen geht nur der gescannte Barcode oder ein Suchbegriff an Open Food Facts.

## Quellen

- Produktdaten: [Open Food Facts](https://world.openfoodfacts.org), Open Database License (ODbL).
- Lose Lebensmittel: Max Rubner-Institut (2025), Bundeslebensmittelschlüssel (BLS) 4.0, Deutsche Nährstoffdatenbank, Karlsruhe. DOI [10.25826/Data20251217-134202-0](https://doi.org/10.25826/Data20251217-134202-0).
- Barcode-Erkennung ohne eingebauten Scanner: [barcode-detector](https://github.com/Sec-ant/barcode-detector) 2.3.1 (MIT) mit [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 1.3.4 (Apache 2.0), liegen in `vendor/`.
- Schriften in `fonts/`: Atkinson Hyperlegible, Bricolage Grotesque, JetBrains Mono, alle unter der SIL Open Font License.

## Änderungen

Aufbau, gespeicherte Daten und der Update-Ablauf stehen in [ENTWICKLUNG.md](ENTWICKLUNG.md). Kurz: `VERSION` in `app.js` und `CACHE` in `sw.js` hochzählen, sonst sehen installierte Apps die neue Fassung nicht.
