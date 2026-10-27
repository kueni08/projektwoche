# Projektwoche

Webanwendung für neun Angebote, zwei Blöcke (Mo./Di. und Mi./Do.) und ungefähr 100 Kinder. Die Oberfläche läuft auf GitHub Pages, die gemeinsame Planung im Supabase-Projekt in Zürich. Auf Schul-PCs ist keine Installation nötig.

## Ablauf

1. Lehrpersonen melden sich mit dem Lehrpersonencode an.
2. Unter **Angebote** die neun Posten und die Plätze je Block prüfen. Die Angebote aus dem Flyer sind bereits eingetragen.
3. Unter **Kinderliste** die Excel-Liste herunterladen. In jeder Kinderzeile ein eindeutiges Kürzel und den Namen eintragen. Nach der Befragung mindestens vier Posten mit `x` markieren. Kinder ohne abgeschlossene Befragung dürfen zunächst leere Wunschfelder haben. Die **Dummy-Liste zum Test** enthält 18 fiktive Kinder und passt sich den aktuellen Angebotsnamen an.
4. Dieselbe Excel-Datei unter **Kinderliste** importieren. Die App prüft Kürzel, Namen und Wahlen und zeigt vor dem Speichern die Anzahl Kinder. Der Import ersetzt die gemeinsame Kinderliste und alle Wahlen in einem atomaren Schritt.
5. In **Gruppenplanung** bei Bedarf Regeln für Kinderpaare festlegen und Kinder einzeln über das Dropdown zur **Wintermarktband** hinzufügen. Bandkinder besuchen jeden Morgen von 08.20–09.55 Uhr die Band und ihren eingeteilten Posten erst von 10.25–12.00 Uhr. Waldtage und Basteln ist für Bandkinder ausgeschlossen; bestehende Konflikte erscheinen rot und müssen umgeteilt werden. Einen Gruppenvorschlag berechnen, prüfen und speichern. Fixierte Zuteilungen bleiben erhalten.
6. Den Plan freigeben und unter **Drucken** Postenlisten je Tag, Wintermarktbandlisten, Gesamtübersicht oder einen Ablaufplan je Kind ausgeben.

Kinder melden sich nicht in der App an. Es gibt keine Kindercodes oder Kinderlinks. Die öffentliche Seite zeigt nur die neun Angebote.

## Namen und gemeinsame Daten

Online gespeichert werden Kürzel, Wahlen, Angebote, Paarvorgaben und Gruppeneinteilungen. Namen stehen ausschliesslich in der Excel-Datei und im lokalen Browser der Lehrperson, die sie importiert. Die Excel-Datei wird im Browser gelesen und nicht an den Server gesendet. Auf einem anderen PC werden Namen sichtbar, wenn dort dieselbe Excel-Datei importiert wird. Die Namen im Browser können unter **Kinderliste** entfernt werden. Dateien und Ausdrucke mit Namen vertraulich aufbewahren.

Ein Kürzel kann zusammen mit anderen Informationen identifizierbar sein; die Daten sind daher pseudonymisiert. Verwende neutrale, eindeutige Kürzel. Der Server nimmt nur Kürzel aus Buchstaben, Ziffern, `_` und `-` mit höchstens 20 Zeichen an.

## Gleichzeitiges Arbeiten

Browser laden den gemeinsamen Stand alle fünf Sekunden neu. Veraltete Schreibzugriffe werden mit einem Konflikthinweis abgelehnt. Ein Import ersetzt die Kinderliste vollständig; lade vor dem Weiterbearbeiten die aktuelle Excel-Liste herunter. Entfernte Kürzel werden auch aus Zuteilungen und Paarvorgaben entfernt. Ohne Verbindung bestätigt die App keine Speicherung.

## Verteilung

Der Vorschlag berücksichtigt gewählte Angebote, Platzgrenzen, Wintermarktband und Fixierungen und gleicht Gruppengrössen aus. Bei Paarvorgaben gelten die Zusammen- oder Trennregeln für beide Blöcke. Die beiden Posten eines Kindes müssen verschieden sein. Die automatische Suche kann bei sehr engen Regeln keinen vollständigen Vorschlag finden; dann Wünsche, Plätze und Fixierungen prüfen. Zuteilungen ausserhalb der gewählten Angebote benötigen eine ausdrückliche Bestätigung.

## Entwicklung und Veröffentlichung

Node.js 22 oder neuer. Für Excel wird eine lokal mitgelieferte Browserkopie von ExcelJS verwendet.

```sh
npm ci
npm test
npm run dev
```

GitHub Actions testet Änderungen und veröffentlicht `public/` auf GitHub Pages. Das Backend läuft als Supabase Edge Function mit Tabellen aus `supabase/migrations/`; Backendänderungen müssen separat an Supabase veröffentlicht werden. `public/config.js` enthält die Funktions-URL. Der Lehrpersonencode gehört nicht ins Repository.

Die Tests prüfen Excel-Import und -Export, die Dummy-Liste, atomare Speicherung, Zugriffsschutz, Paarvorgaben, Wintermarktband und die Verteilung von 100 Kindern.
