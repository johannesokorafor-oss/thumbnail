# Thumbnail Studio

Lokale Desktop-/Web-App, die aus einem fertigen YouTube-Skript automatisch ein professionelles
16:9-Thumbnail erzeugt.

> Skript in den Input-Ordner legen → App erkennt die Datei → analysiert das **komplette** Skript →
> entwickelt mehrere grundverschiedene Thumbnail-Konzepte → generiert mehrere Varianten mit einer
> Premium-Bild-KI → bewertet sie visuell → wählt die stärkste → setzt den Thumbnail-Text
> typografisch sauber → exportiert alles in einen eigenen Ausgabeordner.

---

## Inhalt

1. [Installation](#installation)
2. [Konfiguration](#konfiguration)
3. [API-Key Einrichtung](#api-key-einrichtung)
4. [Starten](#starten)
5. [Ordnerstruktur](#ordnerstruktur)
6. [Wie man ein Skript verarbeitet](#wie-man-ein-skript-verarbeitet)
7. [Quality Modes](#quality-modes)
8. [Kostenkontrolle](#kostenkontrolle)
9. [Regeneration](#regeneration)
10. [Testmodus](#testmodus)
11. [Tests & Build](#tests--build)
12. [Troubleshooting](#troubleshooting)
13. [Architektur](#architektur)
14. [Bekannte Limitationen](#bekannte-limitationen)

---

## Installation

Voraussetzung: **Node.js 20 oder neuer** (getestet mit Node 22).

```bash
npm install
copy .env.example .env      # Windows
cp .env.example .env        # macOS/Linux
```

Unter Windows genügt anschließend ein Doppelklick auf **`start.bat`** – das Skript installiert bei
Bedarf die Abhängigkeiten, legt die `.env` an, baut die Oberfläche und startet die App.

---

## Konfiguration

Alles ist zentral konfigurierbar – in der `.env` (Defaults) und zur Laufzeit in der Oberfläche unter
**Einstellungen** (wird in `data/runtime/settings.json` gespeichert und überschreibt die `.env`).

| Variable | Bedeutung | Default |
|---|---|---|
| `OPENAI_API_KEY` | API-Key (nur serverseitig) | – |
| `ANALYSIS_MODEL` | Reasoning-Modell für Analyse/Strategie/Kritik | `gpt-6-astra` |
| `ANALYSIS_MODEL_FALLBACK` | günstigeres Ersatzmodell | `gpt-5-mini` |
| `IMAGE_PROVIDER` | `openai` \| `google` | `openai` |
| `IMAGE_MODEL` | primäres Bildmodell | `gpt-image-2.5-sunburst` |
| `IMAGE_MODEL_FALLBACK` | Ersatz-Bildmodell | `gpt-image-2.5-flare` |
| `IMAGE_QUALITY` | `max` → `xhigh` → `high` → `medium` (automatischer Fallback) | `max` |
| `IMAGE_SIZE` | Zielauflösung | `2560x1440` |
| `QUALITY_MODE` | `FAST` \| `BALANCED` \| `MAX` | `BALANCED` |
| `VARIANT_COUNT` / `MAX_VARIANT_COUNT` | Varianten pro Job / Obergrenze | `4` / `6` |
| `TEXT_MODE` | `LOCAL_OVERLAY` \| `AI_RENDERED` \| `BOTH_FOR_COMPARISON` | `LOCAL_OVERLAY` |
| `INPUT_FOLDER` … `REFERENCE_FOLDER` | Arbeitsordner | siehe unten |
| `MAX_COST_PER_JOB` / `MAX_COST_PER_DAY` | Kostenlimits (USD, Schätzung) | `2.50` / `25.00` |
| `TEST_MODE` | Pipeline ohne API-Kosten | `true`, solange kein Key gesetzt ist |
| `PORT` | Port der App | `3000` |

Zusätzlich beschreibt **`data/channel-profile.json`** den Kanal-Look: Stil, Farbstimmungen,
Schrift, Textregeln, bevorzugte Motivgröße, Markenregeln und verbotene Elemente. Die Datei ist
direkt in der Oberfläche editierbar.

### Windows-Pfade

Die `.env.example` enthält Windows-Beispielpfade (`C:\YouTube\Scripts\Incoming`). Läuft die App
nicht unter Windows, werden diese automatisch auf `data/workspace/...` im Projektordner umgebogen,
damit nichts kaputtgeht. Eigene Pfade jederzeit in den Einstellungen setzen.

---

## API-Key Einrichtung

1. Key auf der OpenAI-Plattform erzeugen.
2. In die `.env` eintragen:
   ```env
   OPENAI_API_KEY=sk-...
   TEST_MODE=false
   ```
3. App neu starten.

**Sicherheit:** Der Key wird ausschließlich serverseitig aus der Umgebung gelesen
(`src/ai/providers/openai/client.ts`). Er landet nie im Frontend-Bundle, nie in einer API-Antwort,
nie im Log (das Logging redigiert Keys automatisch) und nie in Git (`.env` steht in `.gitignore`).

---

## Starten

```bash
npm run dev     # Backend (tsx watch, Port 3000) + Vite-UI (Port 5173) parallel
npm start       # Produktionsstart: UI bauen + Server starten → http://localhost:3000
npm run e2e     # kompletter End-to-End-Durchlauf mit dem Beispielskript
```

Unter Windows: **`start.bat`** doppelklicken.

---

## Ordnerstruktur

```
Scripts/Incoming/          ← überwachter Input (.txt, .md)
Thumbnails/Generated/      ← ein Unterordner pro Skript
Thumbnails/Archive/        ← Kopie des verarbeiteten Skripts
Thumbnails/Failed/         ← fehlgeschlagene Skripte + Fehlerbericht
ThumbnailReferences/       ← optionale Referenzbilder (nur Stilanalyse, keine Kopie)
```

Pro Skript entsteht:

```
Generated/Alchemie_Das_verbotene_Wissen/
  FINAL_THUMBNAIL.jpg      ← fertiges Thumbnail (Upload-Datei)
  FINAL_THUMBNAIL.png
  CLEAN_ART.png            ← KI-Artwork ohne Text
  VARIANT_01..04.png/.jpg  ← alle generierten Varianten
  MOBILE_PREVIEW.jpg       ← 320px-Simulation
  THUMBNAIL_ANALYSIS.json  ← vollständige Metadaten
  PROMPT_USED.txt          ← exakt verwendeter Bildprompt
```

Dateinamen werden sanitized (`Alchemie – Das verbotene Wissen!!!????` → `Alchemie_Das_verbotene_Wissen`),
Umlaute transliteriert, Windows-Reservednamen abgesichert.

---

## Wie man ein Skript verarbeitet

1. App starten und Oberfläche öffnen.
2. `.txt`- oder `.md`-Skript in den Input-Ordner kopieren.
3. Der Watcher erkennt die Datei, prüft, ob sie fertig geschrieben ist (Größenstabilität über
   mehrere Messungen) und stellt sie in die Warteschlange.
4. Im Dashboard läuft der Workflow sichtbar durch:
   *Skript erkannt → Analyse → Konzepte → Varianten → Bewertung → Finalisierung → Fertig.*
5. Das fertige Thumbnail liegt in
   `Thumbnails/Generated/<Skriptname>/FINAL_THUMBNAIL.jpg`.

Alternativ: Reiter **Input-Ordner** → *Verarbeiten* bzw. *Alle neuen verarbeiten*.

**Duplikaterkennung:** Jede Datei wird per SHA-256 erfasst. Dieselbe Datei wird nicht erneut
generiert; eine inhaltliche Änderung erzeugt einen neuen Hash und damit einen neuen Job.
Mit *Erneut erzwingen* lässt sich das übergehen.

---

## Quality Modes

| Modus | Konzepte | Varianten | Bewertung | Zweite Generierung |
|---|---|---|---|---|
| `FAST` | 3 | 2 | verkürzt | nein |
| `BALANCED` (Default) | 5 | 4 | vollständig | nein |
| `MAX` | 5 | 5 | vollständig | ja, gezielt für den Favoriten |

---

## Kostenkontrolle

* Pro Job werden Anzahl Generierungen, Modell, Qualität und geschätzte Kosten erfasst.
* Dashboard zeigt Tages- und Sessionsumme.
* `MAX_COST_PER_JOB` und `MAX_COST_PER_DAY` stoppen den Job hart, bevor ein Limit überschritten wird.
* **Alle Kostenangaben sind Schätzungen** aus Modell-/Qualitätsparametern (`cost_is_estimate: true`),
  keine Abrechnung. Die Preistabelle steht zentral in `src/pipeline/costTracker.ts`.

---

## Regeneration

Im Reiter **Thumbnails** gibt es pro Ergebnis:

| Button | Wirkung |
|---|---|
| `REGENERATE` | kompletter Durchlauf neu |
| `REGENERATE VARIANTS` | Analyse & Konzepte bleiben, nur Bilder neu |
| `EDIT CONCEPT` | Konzepte werden neu entwickelt |
| `CHANGE TEXT` | nur Text + Overlay neu, keine Bildkosten |
| `OPEN OUTPUT FOLDER` | Ausgabeordner im Explorer öffnen |
| *pro Variante* | einzelne Variante neu generieren |

Die Pipeline ist granular: ein fehlgeschlagenes Overlay löst keine neue Bildgenerierung aus,
eine fehlgeschlagene Bildgenerierung keine neue Skriptanalyse.

---

## Testmodus

`TEST_MODE=true` ersetzt beide Provider durch deterministische Mock-Provider. Es werden echte
Bilddateien (Sharp/SVG) und schemakonforme Analysen erzeugt, sodass Watcher, Parser, Pipeline,
JSON-Ausgabe, Image-Handling, Overlay, QA, Export und UI vollständig testbar sind – ohne API-Kosten.

---

## Tests & Build

```bash
npm test         # 45 Tests: Sanitizing, Parser, Watcher-Filter, Retry, Score,
                 # Prompt-Builder, Typografie, QA, Kosten, Logging + kompletter E2E-Lauf
npm run typecheck
npm run build    # tsc --noEmit + Vite-Build der UI
npm run e2e      # legt das Beispielskript in den Input-Ordner und prüft den Gesamtablauf
```

---

## Troubleshooting

| Problem | Ursache / Lösung |
|---|---|
| Jobs bleiben auf `WAITING` | Kein API-Key oder Provider nicht erreichbar → Key setzen oder `TEST_MODE=true`. |
| `Bildmodell nicht verfügbar` | Das konfigurierte Modell existiert für den Account nicht. Die App versucht automatisch `IMAGE_MODEL_FALLBACK`; sonst in den Einstellungen ein verfügbares Modell eintragen. |
| Datei wird nicht erkannt | Nur `.txt`/`.md`; temporäre Dateien (`~$`, `.tmp`, `.crdownload`, Dotfiles) und Ausgabedateien werden bewusst ignoriert. |
| „Datei bereits verarbeitet“ | Duplikaterkennung per SHA-256 → *Erneut erzwingen* im Input-Reiter. |
| Watcher reagiert auf Netzlaufwerken nicht | Watcher nutzt unter Windows Polling; bei Netzwerkpfaden ggf. *Input-Ordner scannen* verwenden. |
| Overlay-Schrift sieht anders aus | Die Display-Schrift muss im System installiert sein (`font` in den Einstellungen). Ohne Inter greift die Fallback-Kette bis `sans-serif`. |
| Port 3000 belegt | `PORT` in der `.env` ändern. |
| Bild kommt kleiner als 2560x1440 | Die API kann die Größe herabstufen; die App skaliert anschließend verlustarm (Lanczos) auf die Zielauflösung und prüft das in der QA. |

---

## Architektur

```
src/
  ai/
    providers/        ImageProvider/TextProvider-Interfaces
      openai/         Images API + Responses API (offizielles SDK)
      google/         Gemini-Platzhalter (Interface bereits verdrahtet)
      mock/           TEST_MODE-Provider
    analysis/         Skriptanalyse (Long-Context + Chunk-Merge)
    thumbnail/        Strategie, Design-Score, Textgenerierung, Auswahl
    prompting/        mehrschichtiger Prompt-Builder
    critique/         visuelle Kritik, Mobile-Check, Referenz-Stilanalyse
  pipeline/           Orchestrator, Queue, Jobs, Kostentracking, Pipeline
  files/              Watcher, Parser-Registry, JSON-Storage
  image/              Normalisierung, Overlay/Typografie, QA
  config/             zentrale Konfiguration + Kanalprofil
  api/                Express-API + SSE
  types/ utils/
ui/                   React-Oberfläche (Vite)
tests/ scripts/ docs/ data/
```

Rollen der Pipeline (bewusst getrennt, auch wenn sie dasselbe Modell nutzen):
`SCRIPT ANALYZER → THUMBNAIL STRATEGIST → PROMPT ENGINEER → IMAGE GENERATOR → IMAGE CRITIC → FINALIZER`.

Mehr Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Datenschutz

Die App läuft vollständig lokal: keine Cloud-Datenbank, keine Registrierung, keine Telemetrie.
Zur KI-Analyse wird ausschließlich der Skripttext an den konfigurierten Provider übertragen –
das steht auch sichtbar in den Einstellungen.

---

## Bekannte Limitationen

* `.docx` und `.pdf` sind noch nicht implementiert; die Parser-Registry ist dafür aber vorbereitet
  (`parserRegistry.register(...)`).
* Der Gemini-Bildprovider ist als Interface vorhanden, aber in Version 1 bewusst nicht implementiert.
* Kostenangaben sind Schätzungen, keine Abrechnungsdaten.
* Die Modell-IDs (`gpt-image-2.5-sunburst`, `gpt-6-astra`) stehen zentral in der Config; ist ein
  Modell für den Account nicht verfügbar, erkennt die App das und nutzt den konfigurierten Fallback.
* Die Bewertung der Varianten ist so gut wie das eingesetzte Vision-Modell; die deterministische
  QA (Seitenverhältnis, Auflösung, Kontrast, Textpräsenz, tote Flächen) läuft zusätzlich lokal.
