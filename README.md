# GigMan

Lokale Desktop-App zum Vorbereiten von Gitarren-Gigs. Keine Anmeldung, kein Cloud-Dienst. Deutsche Oberfläche mit Dark Mode, großen Transporttasten und Tastatursteuerung.

## Starten

Benötigt Node.js 22.12 oder neuer. Im Projektverzeichnis:

```powershell
npm install
npm run setup:tools
npm start
```

Der Starter baut die Oberfläche und öffnet das Desktop-Fenster. Beim Installieren wird die passende Electron-Laufzeit heruntergeladen. Die Anwendung funktioniert anschließend ohne Internet. `npm run dev` dient ausschließlich der Oberflächenentwicklung; Dateidialoge und Bibliothek benötigen Electron.

## Üben

1. **Neue Setliste** anlegen, Namen eingeben und einen MP3-Ordner wählen. Nur MP3s direkt im Ordner werden kopiert; Unterverzeichnisse werden ignoriert. Weitere MP3s über **MP3-Dateien hinzufügen** importieren.
2. Songs am Griff links per **Drag-and-drop** sortieren.
   **Doppelklick auf einen Songnamen** macht ihn direkt in der Zeile editierbar. Enter oder Klick außerhalb speichert, Escape bricht ab. Leere Namen werden nicht übernommen.
3. Mit **P** den ausgewählten ganzen Track ohne Loop abspielen, auch wenn bereits Sektionen existieren oder Loop Mode aktiv ist. Ein Klick in die freie Waveform startet die Vorschau an dieser Stelle. Leertaste pausiert und setzt sie fort. Die Vorschau endet nach diesem Song.
4. Bereich in der Waveform ziehen, Name und Grenzen festlegen. Sektion in der **Mitte ziehen** verschiebt sie mit unveränderter Länge. Die **Griffe am linken und rechten Rand** verschieben Start bzw. Ende, um sie zu vergrößern oder zu verkleinern. Änderungen werden automatisch gespeichert. Wird ein laufender Loop verändert, startet er mit den neuen Grenzen erneut. **Rechtsklick auf eine Sektion → Löschen** entfernt sie direkt. **Doppelklick** öffnet die Bearbeitung. Die Plus-Taste neben der Waveform erlaubt genaue Zeitangaben, auch bei kurzen Sektionen.
5. In jeder Songzeile stehen linksbündig **Start, Pause, Stop, Abspielen: Komplett / Loops, Vorzählen & BPM, Lautstärke, Tempo und Tonhöhe**. Die Symboltasten steuern diesen Song; die drei Transporttasten oben steuern die ganze Setliste. Im **Song Mode** oben durchläuft die App die Setliste und verwendet die Einstellungen des jeweiligen Songs: **Komplett** spielt den ganzen Track einschließlich unmarkierter Stellen; **Loops** spielt seine Sektionen einmal in zeitlicher Reihenfolge. Songs ohne Sektionen werden immer komplett gespielt. Beim ersten Öffnen werden bisherige globale Audio- und Vorzählwerte in die Songs übernommen.
6. **Loop Mode** wiederholt die angeklickte Sektion. Vorzählen erfolgt beim ersten Start, nicht bei jeder Wiederholung.
7. Pro Song die **Wechselpause** zwischen 0 und 600 Sekunden einstellen. Sie beginnt nach der letzten Sektion vor dem nächsten Song. Danach wird für den nächsten Song erneut vorgezählt. Nach dem letzten Song endet die Wiedergabe.

## YouTube-Import

In einer geöffneten Setliste **YouTube → MP3** anklicken, eine Video-URL einfügen und **Als MP3 importieren** wählen. Die App lädt das Audio, wandelt es in MP3 um und fügt den Song mit Videotitel zur Setliste hinzu. Fortschritt und Umwandlung werden angezeigt; **Abbrechen** beendet den Download und entfernt temporäre Dateien. Die fertige MP3 bleibt wie andere importierte Dateien lokal verfügbar.

Unterstützt werden einzelne öffentliche YouTube-Videos einschließlich Kurzlinks und Shorts, keine Playlists, Livestreams oder Videos mit Anmeldung. Für den Download ist Internet nötig. YouTube kann einzelne Videos oder automatisierte Downloads blockieren; die App zeigt dann einen verständlichen Fehler. Es werden keine Browser-Cookies oder Kontodaten verwendet. Nur Inhalte herunterladen, für die du die entsprechende Berechtigung hast.

Die Windows-Pakete enthalten yt-dlp, FFmpeg und FFprobe. Bei Nutzung des Quellcodes bereitet `npm run setup:tools` diese Werkzeuge für das aktuelle Betriebssystem vor. yt-dlp wird aus dem offiziellen Release geladen und per SHA-256 geprüft. Mit `npm run setup:tools -- --update` kann die Download-Komponente aktualisiert werden; ein neues Paket muss anschließend neu gebaut werden.

**Tempo pro Song:** 50–125 %, unabhängig von der Tonhöhe. **Tonhöhe pro Song:** −12 bis +12 Halbtöne. Diese Werte gelten auch für Vorschau und Loop Mode. **Lautstärke pro Song:** 0–100 %. **Vorzählen pro Song:** aus, 2, 4 oder 8 hörbare Schläge bei 30–240 BPM. BPM steuert das Vorzählen und wird nicht aus der MP3 ermittelt. Änderungen an Tempo oder Tonhöhe des aktuell laufenden Songs starten die Audioverarbeitung an der aktuellen Stelle neu; dabei kann eine kurze Unterbrechung auftreten. Ein Wechsel von Komplett / Loops während eines Setlistendurchlaufs hält ihn an; der nächste Start verwendet die neue Auswahl.

Während einer Gitarrenwechsel-Pause beendet die Pause-Taste den Durchlauf. Ein erneuter Start beginnt die Setliste von vorn. Während der Songwiedergabe pausiert die Taste an der aktuellen Position und setzt dort fort.

| Taste | Funktion |
| --- | --- |
| Leertaste | Abspielen / Pause |
| P | Ausgewählten Song vollständig anhören |
| Esc | Stop |
| N | Nächste Sektion; im Loop neu starten |
| L | Song / Loop Mode wechseln |
| − / + | Tempo des ausgewählten Songs um 5 Prozentpunkte ändern |
| ? | Hilfe |

## Speicherung

**Speichern unter …** in der linken Bibliotheksleiste archiviert die aktuelle Setliste oder alle Setlisten als einzelne `.gigman`-Datei. Sie enthält die MP3s, Reihenfolge, Sektionen, Wechselpausen, Abspielumfang, Tempo, Tonhöhe, Vorzählen, BPM und Lautstärke. Der vorgeschlagene Dateiname enthält das Datum. Die automatische lokale Speicherung läuft unabhängig davon weiter; ein Archiv ist eine Momentaufnahme und wird durch spätere Änderungen nicht aktualisiert.

**Laden …** importiert eine Sicherung zusätzlich zu den vorhandenen Setlisten. Gleichnamige Listen erhalten einen Import-Zusatz. MP3s werden wieder in die lokale Bibliothek kopiert. Das Archiv wird dabei nicht verändert und lässt sich auch auf einem anderen Windows- oder Linux-Rechner laden. Prüfsummen erkennen beschädigte Audiodateien vor dem Import. Fehlt eine lokale MP3 beim Sichern, bleibt eine eventuell vorhandene Archivdatei erhalten.

Die `.gigman`-Datei ist ein gewöhnliches TAR/GZIP-Archiv mit `setlists.json` und einem `audio`-Ordner. Für eine unabhängige Archivierung kann sie mit einem geeigneten Archivprogramm geöffnet werden. Zum Laden in GigMan bitte die gesamte Datei unverändert lassen.

MP3s werden beim Import in die lokale App-Bibliothek kopiert. Originaldateien können danach verschoben werden. Setlisten, Reihenfolge, Sektionen, Wechselpausen und Audioeinstellungen werden automatisch als `library.json` gespeichert. Schreibvorgänge erfolgen über eine temporäre Datei und anschließendes Umbenennen.

- Windows: `%APPDATA%\GigMan\` (beim Start aus dem Quellcode: `gigman`)
- Linux: `${XDG_CONFIG_HOME:-~/.config}/GigMan/` (beim Start aus dem Quellcode: `gigman`)

Die Bibliothek enthält `library.json` und `audio/`. Zum Sichern oder Übertragen die App schließen und den gesamten Ordner kopieren. Entfernen eines Songs oder einer Setliste löscht die importierten MP3s nicht automatisch.

Große Dateien brauchen beim ersten Öffnen Zeit für die Waveform-Berechnung. Höchstens zwei vollständig dekodierte Tracks bleiben im Audiocache. Nicht lesbare MP3s werden in der jeweiligen Zeile gekennzeichnet.

## Installationspakete

```powershell
npm run dist:win
```

Erzeugt einen Windows-Installer für x64 in `release/`. Zielsysteme: Windows 10 und 11.

Auf einem Linux-Rechner:

```sh
npm install
npm run dist:linux
```

Erzeugt AppImage und Debian-Paket für x64. Linux-Pakete sollten auf Linux erstellt und dort geprüft werden. Benötigt eine grafische Desktop-Sitzung und funktionierende Audioausgabe. Die Pakete sind nicht signiert.

## Prüfungen

```powershell
npm test
npm run test:desktop
```

Der Desktop-Test erzeugt echte MP3s mit Sinustönen in einem separaten Testverzeichnis. Er prüft Import ohne Unterordner, Kopien, vollständige Vorschau, Springen in der Waveform, Verschieben und Ändern der Sektionen per Maus, Wiedergabereihenfolge, Wechselpausen, Loop/Pause, Tempo und Halbtonverschiebung (einschließlich Frequenzmessung des ausgegebenen Tons), Vorzählen, YouTube-URL-Validierung, Sortierung, Speicherung nach Neustart und Speichern beim sofortigen Schließen. Der YouTube-Import wird zusätzlich mit deterministischen Tests für Download, Fortschritt, Abbruch, temporäre Dateien und Fehler geprüft. `node tests/youtube-live.mjs VIDEO_URL` führt einen optionalen Live-Import aus. Screenshots stehen unter `test-output/`. Musikalische Klangqualität und Linux-Geräteausgabe erfordern Hörtests auf dem Zielgerät.

## Technik und Lizenzen

Electron mit isoliertem Renderer und schmaler IPC-Schnittstelle; Vite; Web Audio; SoundTouchJS als AudioWorklet für voneinander unabhängige Tempo- und Tonhöhenänderung. Audiodateien werden über ein auf die Bibliothek begrenztes Protokoll geladen. Keine externen Schriften oder Dienste.

SoundTouchJS: MPL-2.0. Electron: MIT (weitere Laufzeitlizenzen im Paket). yt-dlp: Unlicense mit zusätzlichen Lizenzen der Standalone-Laufzeit. FFmpeg/FFprobe: GPL/LGPL und weitere Codec-Lizenzen; Hinweise, Lizenztexte und Quellcode-Verweise liegen im Paket unter `resources/tools/`. Der ausschließlich für Tests verwendete MP3-Encoder `@breezystack/lamejs` steht unter LGPL-3.0. Lizenztexte werden mit den npm-Paketen geliefert.
