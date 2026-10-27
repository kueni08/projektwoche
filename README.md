# Projektwoche

Webanwendung für neun Angebote, zwei Blöcke (Mo./Di. und Mi./Do.) und ungefähr 100 Kinder. Oberfläche auf GitHub Pages, gemeinsame Daten im kostenlosen Supabase-Projekt in Zürich. Keine Installation auf Schul-PCs erforderlich.

## Verwendung

1. Lehrpersonen melden sich mit dem separaten Lehrpersonencode an. Dieser gehört weder ins Repository noch in eine Nachricht an Kinder.
2. Neun Angebote benennen und beschreiben. Pro Block die maximale Gruppengrösse festlegen; 0 deaktiviert einen Posten in diesem Block.
3. Unter **Kinder & Namen** die Anzahl eingeben und zufällige vierstellige Codes erzeugen. Namen können direkt lokal ergänzt oder über eine CSV-Codeliste eingelesen werden.
4. Unter **Wahlübersicht** die aktuelle Excel-Vorlage herunterladen. Lehrpersonen befragen die Kinder und markieren pro Kind mindestens vier Angebote mit `x`. Die Vorlage enthält Kennungen und die aktuellen Angebotstitel; vorhandene lokale Namen und Wahlen werden beim Herunterladen eingetragen.
5. Die ausgefüllte `.xlsx` unter **Wahlübersicht** auswählen, die Zusammenfassung prüfen und mit **Vorauswahl für alle Kinder speichern** gemeinsam online übernehmen. Leere Wahlzeilen sind für noch nicht befragte Kinder zulässig. Alle Kinderkennungen müssen vorhanden sein. Namen aus der Datei werden ausschliesslich auf dem importierenden PC gespeichert; die Datei selbst wird nie an den Server gesendet.
6. In **Gruppenplanung** bei Bedarf Kinderpaare als sicher zusammen oder sicher getrennt festlegen. Die Vorgaben gelten in beiden Blöcken. Einen Gruppenvorschlag berechnen, prüfen und speichern. Jedes Kind erhält höchstens einen Posten je Block, die beiden Posten müssen unterschiedlich sein.
7. Manuelle Änderungen sind möglich. Zuteilungen ausserhalb der gewählten Angebote benötigen eine ausdrückliche Bestätigung. Kapazitätsüberschreitungen, doppelte Posten und verletzte Paarvorgaben werden serverseitig abgelehnt. Vollständige Paare können fixiert werden.
8. Vollständigen Plan freigeben. Gruppenlisten, Gesamtübersicht, persönliche Wochenpläne und Codezettel drucken oder mit der Druckfunktion als PDF speichern. Kinder können nach der Freigabe ihre zwei Posten über den Kinderlink und ihren Code ansehen; sie wählen nicht selbst in der App.

## Gleichzeitiges Arbeiten

Browser prüfen den gemeinsamen Stand alle fünf Sekunden. Ungespeicherte Entwürfe werden nicht durch Hintergrundaktualisierungen ersetzt. Schreibzugriffe nutzen atomare Vergleiche der Versionsnummer: veraltete Adminänderungen werden mit einem Konflikthinweis abgelehnt. Ein Excel-Import speichert die Wahlen aller Kinder atomar; bei einer zwischenzeitlichen Änderung muss die Datei erneut geprüft werden. Ohne Verbindung bleibt der Entwurf sichtbar; erst eine erfolgreiche Serverantwort bestätigt die Speicherung.

## Namen und Zugriff

Die Online-Datenbank enthält Kennungen, zufällige Kindercodes, Wünsche, Angebote, Paarvorgaben und Zuteilungen. Das ist Pseudonymisierung, keine vollständige Anonymisierung. Es gibt keinen Namensparameter in der API. Namen sind nur in `localStorage` dieses Browsers und in bewusst heruntergeladenen Dateien. Excel-Vorlagen, CSV und Ausdrucke können echte Namen und geheime Codes enthalten; entsprechend vertraulich aufbewahren.

Die Namensliste kann zusätzlich mit AES-GCM verschlüsselt exportiert werden (PBKDF2-SHA256, 250000 Iterationen, zufälliger Salt und IV). Der Import bleibt vollständig im Browser. Browserdatenlöschung entfernt lokale Namen; vorher sichern. Die lokale Speicherung selbst ist nicht verschlüsselt. Auf gemeinsam genutzten Geräten nach Gebrauch «Namen hier entfernen» verwenden.

Lehrpersonen verwenden einen gemeinsam verwalteten, zufälligen 256-Bit-Zugangscode. Der Server erhält nur dessen SHA-256-Hash als Secret `ADMIN_HASH`. Der eingegebene Code bleibt bis zum Abmelden/Neuladen im Arbeitsspeicher des Browsers. Kindercodes sind zufällig, eindeutig und vierstellig (1000–9999). Zusätzlich wird ein gemeinsamer Kinderlink benötigt, dessen zufälliger Schlüssel im URL-Fragment steht und nur an die eigene API gesendet wird. Der Lehrpersonenbereich zeigt diesen Link an; Codezettel enthalten ihn ebenfalls. 15 falsche Anmeldeversuche pro Netzwerk innerhalb von 15 Minuten führen zu einer zeitlichen Sperre. Vier Ziffern bieten keine starke persönliche Identitätsprüfung; den Kinderlink und fremde Codes vertraulich behandeln. Für personalisierte Lehrpersonenkonten und einzelne Zugriffs-Widerrufe wäre eine spätere Erweiterung erforderlich.

## Gestaltung

Original-Eule und Farb-/Schriftsystem aus `kueni08/unterrichtsplanung-opfikon` (Wochenatelier). `public/logo-eule.svg` bleibt die Originalgrafik; `eule-laedt.svg` ergänzt lediglich eine sanfte Kopfdrehung der Gesichtselemente. Bei reduzierter Bewegung bleibt die Eule statisch. Keine HeCo-Gestaltung.

## Verteilungsverfahren

24 Durchläufe eines Min-Cost-Matching-Verfahrens, abwechselnd mit Block 1 und Block 2 beginnend, vergleichen gültige Vorschläge. Steigende Kosten je weiterem Gruppenplatz bevorzugen ausgeglichene Gruppen. Fixierte Paare bleiben erhalten. Ein nicht vollständig gefundener Vorschlag beweist keine mathematische Unmöglichkeit; Wünsche, Kapazitäten und Fixierungen prüfen. Bei frei verfügbaren neun Angeboten erhalten 100 Kinder pro Block Gruppen mit 11–12 Kindern. Es werden keine nicht gewählten Posten automatisch ergänzt.

## Entwicklung und Veröffentlichung

Node.js 22 oder neuer. Für die Excel-Verarbeitung wird eine lokal mitgelieferte Browserkopie von ExcelJS verwendet; die Tests installieren die Entwicklungsabhängigkeit per `npm ci`.

```sh
npm ci
npm test
npm run dev
```

Die Vorschau läuft unter `http://127.0.0.1:4173`. GitHub Actions testet Änderungen und veröffentlicht `public/` auf GitHub Pages. Das Backend läuft als Supabase Edge Function mit Datenbanktabellen aus `supabase/migrations/`. Backendänderungen müssen separat an Supabase veröffentlicht werden; der Pages-Workflow aktualisiert nur die Oberfläche.

Für eine eigene Installation: Supabase-Projekt erstellen, `supabase/migrations/20260923010000_projektwoche.sql` ausführen, `ADMIN_HASH` als Edge Function Secret hinterlegen und `supabase/functions/projektwoche/` veröffentlichen (JWT-Prüfung für diese Funktion deaktivieren; die Funktion prüft ihre eigenen Codes). `public/config.js` auf die tatsächliche Funktions-URL setzen. Keine Zugangsdaten in Git committen. `backend/schema.sql` bleibt nur für lokale Tests erhalten.

Der geplante GitHub-Funktionstest ruft alle zwei Tage den öffentlichen Projektstand aus der Datenbank ab. Bei Fehlern wird der Workflow rot. GitHub kann Zeitpläne nach 60 Tagen ohne Repository-Aktivität deaktivieren; der Test ist daher keine Garantie gegen eine spätere Pause im Supabase-Gratisplan.

Die Tests prüfen die Verteilung mit 100 Kindern, Paarvorgaben, Fixierungen, Kapazitäten, Excel- und CSV-Rundläufe, Zugriffsschutz und atomare Importe gegen SQLite. Vor realem Einsatz Angebote und Kapazitäten einrichten und einen Probedurchlauf durchführen.
