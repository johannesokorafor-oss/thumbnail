# Architektur

## Leitgedanke

Nicht das Skript abbilden, sondern die stärkste visuelle und emotionale Idee herausarbeiten.
Die Pipeline trennt deshalb strikt zwischen *Inhaltsverständnis*, *Bildidee*, *Bilderzeugung*,
*Bewertung* und *Komposition*.

## Datenfluss

```
INPUT (.txt/.md im Input-Ordner)
  ↓ ScriptWatcher        Stabilitätsprüfung, Temp-/Output-Filter, kein Doppel-Ingest
  ↓ registerScript       SHA-256-Duplikaterkennung, Job-Datensatz
  ↓ JobQueue             serielle Abarbeitung (kostenstabil, API-Limit-freundlich)
  ↓ SCRIPT ANALYSIS      komplettes Skript; >45k Zeichen ⇒ Chunking + Merge
  ↓ THUMBNAIL STRATEGY   5 grundverschiedene Konzepte, min. 1 bewusst ungewöhnlich
  ↓ TOP CONCEPTS         gewichteter Design-Score + erzwungene Vielfalt (Textbereiche)
  ↓ PROMPT ENGINE        14 Prompt-Ebenen inkl. TEXT_AREA und NEGATIVE_CONSTRAINTS
  ↓ IMAGE GENERATION     ImageProvider (Modell/Qualität/Größe als API-Parameter)
  ↓ VISUAL CRITIQUE      13 Leitfragen je Variante → Score + Verbesserungsprompt
  ↓ SELECT / IMPROVE     Auswahl + Begründung; im MAX-Modus gezielte zweite Generierung
  ↓ TEXT GENERATION      2–6 Wörter, natürliches Deutsch, ≠ Videotitel
  ↓ TEXT OVERLAY         Sharp/SVG, gemessene Glyphenbreiten, adaptive Farben
  ↓ FINAL QA             16:9, Auflösung, Kontrast, Textpräsenz, tote Flächen, 320px-Check
  ↓ EXPORT               PNG/JPG, CLEAN_ART, Varianten, JSON-Metadaten, Prompt-Dump
```

## Module

| Modul | Verantwortung |
|---|---|
| `config/` | Einzige Quelle für Modelle, Pfade, Limits, Kanalprofil. Keine hart codierten Pfade/Modelle im Code. |
| `files/watcher` | Chokidar + eigene Stabilitätsprüfung, In-Flight-Set gegen Doppel-/Parallelverarbeitung. |
| `files/parser` | Registry-Pattern. Neue Formate: `parserRegistry.register({ extensions, parse })`. |
| `files/storage` | Atomarer JSON-Store (Jobs, Hashes, Kosten) – lokal, kein DB-Server. |
| `ai/providers` | `ImageProvider` / `TextProvider` als Interface. OpenAI, Gemini-Stub, Mock. |
| `ai/analysis` | Strukturierte Skriptanalyse, trennt belegte Aussagen von kreativer Deutung. |
| `ai/thumbnail` | Konzepte, gewichteter Design-Score, Thumbnail-Text, Variantenauswahl. |
| `ai/prompting` | Schichtenprompt, Safe-Area-Formulierungen, Negativliste. |
| `ai/critique` | Variantenkritik, Mobile-Check, abstrakte Referenz-Stilanalyse. |
| `image/` | Normalisierung auf exakt 16:9, Typografie-Overlay, deterministische QA. |
| `pipeline/` | Orchestrator, Queue, Jobverwaltung, Kostentracking, Fehlerbehandlung. |
| `api/` | Express-REST + Server-Sent-Events für die Live-Ansicht. |
| `ui/` | React-Oberfläche: Dashboard, Input, Queue, Ergebnisse, Einstellungen, Logs. |

## Erweiterungspunkte

* **Neuer Bildprovider:** `ImageProvider` implementieren und in `ai/providers/registry.ts` eintragen.
  Die Pipeline importiert nie ein SDK direkt.
* **Neues Eingabeformat:** Parser registrieren – Watcher und Pipeline ändern sich nicht.
* **Andere Modelle:** ausschließlich `.env` bzw. Einstellungen; die App prüft Verfügbarkeit und
  fällt kontrolliert zurück.
* **Andere Bewertungslogik:** Gewichte in `SCORE_WEIGHTS` (`ai/thumbnail/strategist.ts`).

## Fehlerstrategie

* `PermanentError` (fehlender Key, unbekanntes Modell, unsupported file, Kostenlimit) → kein Retry.
* Transiente Fehler (429/5xx/Netzwerk) → exponentielles Backoff mit Jitter, max. 3 Versuche.
* Teilfehler degradieren statt abzubrechen: fehlende Kritik → Score aus dem Konzept;
  fehlgeschlagenes Overlay → Export des Artworks; fehlgeschlagene Archivierung → nur Warnung.
* Bei Jobabbruch: Status `FAILED`, Fehlerbericht + Skriptkopie im Failed-Ordner, Queue läuft weiter.
