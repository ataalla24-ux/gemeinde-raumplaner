# Gemeinde Raumplaner

Ein einfacher MVP fuer eine Raumreservierungs-App fuer Gemeinden:

- Mitglieder koennen einen Raum fuer einen Zeitraum anfragen
- der Pastor sieht offene Anfragen und kann freigeben oder ablehnen
- freigegebene Zeiten werden in einer Uebersicht angezeigt
- freigegebene Zeitraeume koennen nicht doppelt belegt werden

## Starten

```bash
npm start
```

Danach im Browser auf [http://localhost:3000](http://localhost:3000) gehen.

## Pastor-Code

Standardmaessig ist der Demo-Code:

```text
gemeinde123
```

Du kannst ihn beim Starten aendern:

```bash
PASTOR_CODE=mein-sicherer-code npm start
```

## Hinweise

- Die Daten werden lokal in `data/bookings.json` gespeichert.
- Diese Version hat bewusst nur eine einfache Demo-Authentifizierung.
- E-Mails gehen ohne SMTP vorerst in `data/outbox.log`.
- Die App ist als installierbare Web-App vorbereitet (`manifest.webmanifest` und Service Worker).
- Ein iOS-Projekt wurde mit Capacitor in `ios/` erzeugt.
- Fuer Hosting kann `DATA_DIR` gesetzt werden, damit Buchungen auf einem persistenten Speicher liegen.

## Deployment

Die App kann direkt auf Render oder Railway laufen. Fuer Render liegt bereits [render.yaml](/Users/Stefan/Documents/New project/render.yaml) bereit.

Wichtig:

- Ohne persistenten Speicher gehen `bookings.json` und `outbox.log` bei Neustarts verloren.
- Darum nutzt die Render-Konfiguration `DATA_DIR=/var/data/gemeinde-raumplaner` auf einem gemounteten Disk-Volume.
- Beispielwerte fuer Umgebungsvariablen stehen in [.env.example](/Users/Stefan/Documents/New project/.env.example).

Render-Ablauf:

1. Repository zu GitHub pushen.
2. In Render `New +` -> `Blueprint` waehlen.
3. Repository verbinden.
4. Render liest `render.yaml` automatisch ein.
5. `PASTOR_CODE`, `PASTOR_EMAIL`, `EMAIL_FROM` und SMTP-Werte in Render setzen.
6. Nach dem Deploy die HTTPS-URL notieren.

## Installation auf Handy

- iPhone/iPad: In Safari oeffnen, dann `Teilen` -> `Zum Home-Bildschirm`.
- Android: Im Browser oeffnen und `Installieren` oder `Zum Startbildschirm hinzufuegen`.

## iPhone App mit Xcode

Wichtig:

- Die iPhone-App kann den lokalen Node-Server nicht selbst hosten.
- Vor dem echten App-Store-Release solltest du die Web-App auf eine HTTPS-Domain deployen.
- Danach in `capacitor.config.json` und `ios/App/App/capacitor.config.json` die Platzhalter-URL `https://deine-domain-hier-eintragen.de` durch deine echte Domain ersetzen.

Nützliche Befehle:

```bash
npm run cap:sync
npm run cap:open:ios
```

Ablauf:

1. Web-App und Backend auf eigener Domain veroeffentlichen.
2. Die Domain in `capacitor.config.json` eintragen.
3. `npm run cap:sync` ausfuehren.
4. `npm run cap:open:ios` ausfuehren.
5. In Xcode Bundle Identifier, Team, App Icons und Signing pruefen.
6. Dann Archive bauen und nach App Store Connect hochladen.

## SMTP fuer echte E-Mails

Beispiel:

```bash
SMTP_HOST=smtp.dein-anbieter.de \
SMTP_PORT=587 \
SMTP_USER=dein-benutzer \
SMTP_PASS=dein-passwort \
EMAIL_FROM=raumplaner@deine-domain.de \
PASTOR_EMAIL=pastor@deine-domain.de \
npm start
```
