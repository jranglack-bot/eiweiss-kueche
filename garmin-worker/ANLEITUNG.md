# Garmin mit der Eiweiß-Küche verbinden

Der Zwischenserver läuft schon: **https://eiweiss-garmin.j-ranglack.workers.dev** (Cloudflare Worker `eiweiss-garmin`, von Claude mit `npx wrangler deploy` aus diesem Ordner angelegt).
Garmin erlaubt keine Abfrage direkt aus dem Browser. Der Worker hält deinen Garmin-Schlüssel geheim und gibt der App nur die Werte eines Tages.

Es fehlen nur noch zwei Geheimnisse, die du selbst einträgst.

## 1. Zugangscode festlegen

Im Ordner `garmin-worker` im Terminal:

    npx wrangler secret put ZUGANG

Einen selbst ausgedachten Code mit mindestens 16 Zeichen eingeben, zum Beispiel vier zufällige Wörter mit Zahlen dazwischen. Den brauchst du gleich noch einmal in der App.

## 2. Garmin-Schlüssel anlegen und eintragen

1. Am Computer bei Garmin Connect anmelden und https://connect.garmin.com/app/settings/personalApiToken öffnen.
2. **Create Key**, Bedingungen annehmen, Laufzeit **1 Jahr**, Schlüssel kopieren. Er wird nur einmal angezeigt.
3. Im Terminal:

       npx wrangler secret put GARMIN_SCHLUESSEL

   und den Schlüssel einfügen.

Fragt Wrangler nach einer Anmeldung, im Browser bei Cloudflare auf **Allow** klicken.
Ohne Terminal geht beides auch im Cloudflare-Dashboard: Workers & Pages, `eiweiss-garmin`, Settings, Variables and Secrets, Add, Typ Secret.

## 3. In der App verbinden

Profil, **Garmin-Uhr verbinden**. Die Adresse steht schon drin, nur den Zugangscode eintragen, **Verbinden und testen**.

## Was die App daraus macht

- Im Tagebuch erscheint die Karte **Sport von der Uhr** mit deinen Trainings des Tages.
- Von jedem Training zählen die Kalorien ohne den Ruheverbrauch, davon standardmäßig 75 %, weil Uhren eher zu hoch schätzen. Einstellbar im Profil: 50, 75 oder 100 %.
- Diese Kalorien kommen auf dein Tagesziel drauf, die zusätzlichen Kalorien gehen in die Kohlenhydrate. Der Zielrechner rechnet dann ohne Sport.

## Wenn etwas nicht klappt

- **„Worker noch nicht fertig eingerichtet“:** `ZUGANG` fehlt oder hat weniger als 16 Zeichen.
- **„Zugangscode stimmt nicht“:** In App und Worker muss genau derselbe Code stehen.
- **„Garmin lehnt den Schlüssel ab“:** Schlüssel abgelaufen oder nicht vollständig kopiert. Neuen anlegen und `GARMIN_SCHLUESSEL` neu setzen.
- Zum Nachsehen der Originaldaten: vorübergehend die Variable `DEBUG` mit Wert `1` anlegen, dann `?datum=JJJJ-MM-TT&roh=1` mit dem Zugangscode im Kopf `X-Zugang` abrufen, danach `DEBUG` wieder löschen.
- Nach einer Änderung an `worker.js`: im Ordner `garmin-worker` erneut `npx wrangler deploy`.
