# Garmin mit der Eiweiß-Küche verbinden

Einmal einrichten, etwa 15 Minuten. Danach zählen deine Trainings von der Uhr automatisch zum Tagesziel.

Warum ein Zwischenserver? Garmin erlaubt keine Abfrage direkt aus dem Browser. Der kleine Cloudflare Worker hält deinen Garmin-Schlüssel geheim und gibt der App nur die Werte eines Tages. Kostenlos (bis 100.000 Abfragen am Tag).

## 1. Garmin-Schlüssel anlegen

1. Am Computer bei Garmin Connect anmelden.
2. Diese Seite öffnen: https://connect.garmin.com/app/settings/personalApiToken
3. **Create Key**, die Bedingungen lesen und annehmen.
4. Laufzeit wählen, am besten **1 Jahr**. Garmin schickt eine Woche vorher eine Erinnerungs-Mail.
5. Den Schlüssel kopieren und kurz in einer Notiz zwischenspeichern. Er wird nur einmal angezeigt.

## 2. Cloudflare-Konto anlegen

1. https://dash.cloudflare.com/sign-up öffnen und ein kostenloses Konto anlegen.
2. E-Mail bestätigen. Eine Domain brauchst du nicht.

## 3. Worker anlegen

1. Im Cloudflare-Dashboard links **Workers & Pages**, dann **Create**, dann **Create Worker** (Vorlage „Hello World“).
2. Als Namen `eiweiss-garmin` eintragen und **Deploy** klicken.
3. **Edit code** klicken, den gesamten Beispielcode löschen.
4. Den Inhalt von [worker.js](worker.js) komplett hineinkopieren (auf GitHub oben rechts „Copy raw file“).
5. Oben rechts **Deploy**.

## 4. Die zwei Geheimnisse eintragen

1. Zurück zur Worker-Übersicht, dann **Settings**, dann **Variables and Secrets**, dann **Add**.
2. Typ **Secret**, Name `GARMIN_SCHLUESSEL`, Wert: dein Garmin-Schlüssel aus Schritt 1.
3. Noch einmal **Add**: Typ **Secret**, Name `ZUGANG`, Wert: ein selbst ausgedachter Zugangscode mit mindestens 16 Zeichen, zum Beispiel vier zufällige Wörter mit Zahlen dazwischen. Den brauchst du gleich in der App.
4. **Deploy** bestätigen.

Die Adresse des Workers steht oben in der Übersicht, sie sieht so aus: `https://eiweiss-garmin.DEINNAME.workers.dev`

## 5. In der App verbinden

1. In der Eiweiß-Küche auf **Profil**, dann **Garmin-Uhr verbinden**.
2. Adresse des Workers und Zugangscode eintragen, **Verbinden und testen**.
3. Steht „Verbunden. Heute …“ da, bist du fertig.

## Was die App daraus macht

- Im Tagebuch erscheint die Karte **Sport von der Uhr** mit deinen Trainings des Tages.
- Von jedem Training zählen die Kalorien ohne den Ruheverbrauch, davon standardmäßig 75 %, weil Uhren eher zu hoch schätzen. Einstellbar im Profil: 50, 75 oder 100 %.
- Diese Kalorien kommen auf dein Tagesziel drauf, die zusätzlichen Kalorien gehen in die Kohlenhydrate.
- Der Zielrechner rechnet dann ohne Sport, damit nichts doppelt zählt.

## Wenn etwas nicht klappt

- **„Zugangscode stimmt nicht“:** In App und Worker muss genau derselbe Code stehen.
- **„Garmin lehnt den Schlüssel ab“:** Schlüssel abgelaufen oder nicht vollständig kopiert. Neuen anlegen und `GARMIN_SCHLUESSEL` ersetzen.
- **„Im Worker fehlen …“:** Eines der beiden Geheimnisse fehlt oder ist falsch geschrieben.
- **„Worker noch nicht fertig eingerichtet“:** `ZUGANG` fehlt oder hat weniger als 16 Zeichen.
- Zum Nachsehen der Originaldaten, falls Werte fehlen: im Worker vorübergehend die Variable `DEBUG` mit dem Wert `1` anlegen, dann `https://DEIN-WORKER.workers.dev/?datum=2026-10-28&roh=1` mit dem Zugangscode im Kopf `X-Zugang` abrufen, oder Claude fragen. Danach `DEBUG` wieder löschen.
