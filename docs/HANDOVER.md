# Übergabebericht — Qualitätsüberarbeitung

Stand: 2026-09-30 · Branch `arena/01a0eea1-thumbnail`

Dieser Bericht ist bewusst in drei Beweisklassen geteilt. Alles, was **nicht** unter
„durch echten API-Lauf belegt" steht, ist auch nicht belegt.

---

## 1. Geänderte und neue Dateien

### Neu

| Datei | Zweck |
|---|---|
| `src/image/size.ts` | Einzige Quelle der Wahrheit für API-Größenregeln (Vielfache von 16, ≤3840 px, ≤3:1, 655.360–8.294.400 px) und die **reine 16:9-Fallback-Leiter** |
| `src/image/validation/candidateQa.ts` | Deterministische Stufe-1-Prüfung jedes Kandidaten auf echten Pixeln, inkl. 320px-Ansicht, Motivtrennung, Textflächenruhe, perzeptuellem Hash + Duplikaterkennung |
| `scripts/realE2E.ts` | Echter, kostenpflichtiger API-Durchlauf mit vollständigem Soll/Ist-Protokoll und Exportprüfung |
| `scripts/benchmark.ts` | Messlauf über 8 Genres, JSON-Bericht in `data/runtime/benchmark_*.json` |
| `tests/size.test.ts` | 12 Tests zu API-Größenlegalität und Fallback-Ketten |
| `tests/candidateQa.test.ts` | 8 Tests, die die QA gegen echte, per Sharp erzeugte Bilder prüfen |
| `data/examples/` (7 neue Skripte) | Emotionale Menschengeschichte, Mystery, Historisch, Dramatisches Ereignis, Dokumentation, Bildung, Dunkel/Ernst, Inspirierend |
| `docs/AUDIT.md` | Audit **vor** den Codeänderungen, mit 13 belegten Lücken |

### Überarbeitet

| Datei | Kernänderung |
|---|---|
| `src/config/index.ts` | `QualityProfile` statt Preset-Block; FAST/BALANCED/MAX mit `premium`, `allowQualityFallback`, `allowModelFallback`, `refinementPasses`; `resolveRequestedQuality()`; `IMAGE_QUALITY` Default auf `auto` (Modus entscheidet); Budgets auf 8 $/Job, 40 $/Tag |
| `src/ai/providers/types.ts` | `QualityDegradation`, `requested`/`degradations`/`latencyMs` an jedem Bild, `refine()`, Buffer-Bilder für Textanfragen |
| `src/ai/providers/openai/imageProvider.ts` | Premium-Vertrag: `PREMIUM_MODEL_UNAVAILABLE` / `PREMIUM_QUALITY_UNAVAILABLE` statt stiller Herabstufung; jede Abweichung protokolliert; `refine()` über `images.edit` |
| `src/ai/prompting/promptBuilder.ts` | Strategieabhängige Bildregie; Abschnitte SCENE / COMPOSITION AND CAMERA / EMOTION / LIGHTING / COLOR / STYLE / THUMBNAIL FUNCTION / RESERVED SPACE / AVOID / ACCURACY; 6 knappe, widerspruchsfreie Negativvorgaben; `buildRefinementPrompt` |
| `src/ai/thumbnail/strategist.ts` | Art-Director-Prompt mit 8 Strategien, erzwungene Strategie- und Textflächen-Vielfalt, Pflicht-Ausreißerkonzept, `conceptDistance()` |
| `src/ai/critique/imageCritic.ts` | Kritik auf echten Pixeln in **zwei Ansichten** (voll + 320px); `rankCandidatesVisually()` vergleicht alle Kandidaten als Bilder; `finalCompositionCheck()` prüft das fertige Thumbnail |
| `src/pipeline/pipeline.ts` | Stufe-1-Gate, Duplikatverwerfung, Kritik nur für Überlebende, Auswahl per Bildvergleich, wiederholt geprüfte Verfeinerung, vollständige Soll/Ist-Metadaten, `resumeFrom: 'overlay'` generiert keine Bilder mehr neu |
| `src/ai/providers/mock/index.ts` | Mock-Bewertungen stammen aus gemessenem Kontrast/Belichtung/Kantenenergie der echten Datei (keine Konstanten mehr); jedes Mock-Bild trägt eine `degradation` |
| `src/pipeline/costTracker.ts` | Schätzung anhand der veröffentlichten Token-Preise ($30 / 1 Mio. Output-Tokens), skaliert nach Megapixel und Modell |
| `src/files/storage/store.ts` | Prozesssichere atomare Schreibvorgänge (eindeutiger Temp-Name) |
| `ui/src/views/Results.tsx`, `ui/src/api.ts` | Karte „Tatsächlich verwendete Generierung" (Soll/Ist + Abweichungen), Karte „Direkter Bildvergleich", pro Kandidat: Verwerfungsgrund, lokale QA-Tabelle, Begründungen, Latenz |
| `README.md`, `.env.example` | Dokumentation des tatsächlichen Verhaltens inkl. Ehrlichkeitsgarantie und TEST_MODE-Warnung |

---

## 2. Tatsächlich verwendetes Modell / Qualität / Größe

**Konfiguriert und vom Code angefragt** (`npm run e2e:real` gibt dies vor dem Lauf aus):

| Parameter | Wert |
|---|---|
| API | OpenAI Images API (`images.generate`, `images.edit`), Analyse über Responses API |
| Bildmodell | `gpt-image-2.5-sunburst` (Fallback `gpt-image-2.5-flare`, in BALANCED/MAX **gesperrt**) |
| Qualität | MAX → `max`, BALANCED → `xhigh`, FAST → `high`; `IMAGE_QUALITY` überschreibt explizit |
| Größe | `2560x1440`, als API-Parameter, nie im Prompt |
| Fallback-Größen | ausschließlich 16:9: 3840x2160 / 2560x1440 / 2048x1152 / 1792x1008 / 1536x864 / 1280x720 |

**Tatsächlich ausgeführt wurde in dieser Umgebung nur TEST_MODE** — dort ist das Modell
`mock-image-model` und jedes Bild trägt eine Abweichungsmeldung.

---

## 3. Ergebnis des echten API-Tests

**Nicht durchgeführt.** In dieser Umgebung existiert kein `OPENAI_API_KEY`. `scripts/realE2E.ts`
bricht in diesem Fall mit Exit-Code 2 ab und weist ausdrücklich darauf hin, dass ein TEST_MODE-Lauf
kein Nachweis ist. Der Test liegt einsatzbereit vor:

```bash
OPENAI_API_KEY=sk-… QUALITY_MODE=MAX npm run e2e:real
```

Es gibt folglich **keinen Beleg** dafür, dass die erzeugten Bilder professionell aussehen.
Belegt ist nur, dass die Pipeline die dafür nötigen Anfragen korrekt stellt und Abweichungen meldet.

---

## 4. Kandidaten, Auswahl, QA — letzter Messlauf (TEST_MODE, BALANCED, 8 Genres)

| Genre | Status | Kandidaten | verworfen | lokale QA bestanden | Kritik-Scores | gewählt | finale QA |
|---|---|---|---|---|---|---|---|
| Emotionale Menschengeschichte | COMPLETED | 4 | 1 | 3 | 4.32 / 4.44 / 4.90 | #4 | OK |
| Mystery | COMPLETED | 4 | 2 | 2 | 4.40 / 4.98 | #2 | OK |
| Historisch | COMPLETED | 4 | 1 | 3 | 3.74 / 4.60 / 3.82 | #2 | OK |
| Dramatisches Ereignis | COMPLETED | 4 | 1 | 3 | 4.45 / 4.40 / 4.72 | #1 | OK |
| Dokumentation | COMPLETED | 4 | 2 | 2 | 4.08 / 4.77 | #4 | OK |
| Bildung | COMPLETED | 4 | 1 | 3 | 4.55 / 3.99 / 3.84 | #1 | OK |
| Dunkel / Ernst | COMPLETED | 4 | 2 | 3 | 5.01 / 4.67 | #1 | OK |
| Inspirierend | COMPLETED | 4 | 2 | 2 | 4.08 / 4.77 | #4 | OK |

8/8 abgeschlossen · 32 Kandidaten erzeugt · 12 verworfen · ~13 s pro Skript ·
geschätzte Kosten des Laufs 12,73 $ (fiktiv, da TEST_MODE) · Modell `mock-image-model`,
Qualität `xhigh`, Größe `2560x1440`, 4 protokollierte Abweichungen je Job (je ein Mock-Hinweis pro Bild).

> Diese Zahlen belegen ausschließlich, dass Erzeugung, Verwerfung, Bewertung, Auswahl und Export
> funktionieren. Über Bildqualität sagen sie nichts aus — die Bilder sind Platzhalter.

Ein zusätzlicher MAX-Lauf (`npm run e2e`) hat zusätzlich die Verfeinerungsschleife ausgeführt:
`Verfeinerung 1 übernommen (3.72 → 3.95)`, also eine erneut bewertete und nur bei Verbesserung
übernommene Korrektur.

---

## 5. Tests und Build

| Prüfung | Ergebnis |
|---|---|
| `npm test` | **70 Tests in 10 Dateien, alle grün** (vorher 45) |
| `npm run typecheck` / `tsc --noEmit` | fehlerfrei |
| `npm run build` | fehlerfrei, UI-Bundle 251,67 kB (gzip 76,93 kB) |
| `npm run e2e` (TEST_MODE, MAX) | COMPLETED, alle Pflichtdateien erzeugt, QA bestanden |
| `npm run benchmark` (TEST_MODE) | 8/8 COMPLETED |
| `npm run e2e:real` | **nicht ausgeführt — kein API-Key** |

Ein durch die neuen Tests gefundener echter Fehler: `1920x1080` war in der Fallback-Leiter
enthalten, ist aber **nicht API-konform** (1080 ist kein Vielfaches von 16). Korrigiert.

---

## 6. Beweislage

### Durch echten API-Lauf belegt
*Nichts.* Es waren keine Zugangsdaten vorhanden.

### Durch automatisierte Tests / reproduzierbare Läufe belegt
* API-Größenregeln und die ausschließlich 16:9-basierte Fallback-Leiter (12 Tests).
* Die Kandidaten-QA misst echte Pixel: flache Bilder fallen durch, Bilder mit klarem Motiv und
  ruhiger Textfläche bestehen, falsche Seitenverhältnisse werden erkannt, die Bewertung der
  Textfläche hängt nachweislich von der geplanten Position ab, Messwerte sind reproduzierbar.
* Duplikaterkennung über perzeptuellen Hash verwirft den schwächeren von zwei gleichen Kandidaten.
* Der komplette Pipelinelauf erzeugt alle Pflichtdateien, protokolliert Soll/Ist und Abweichungen,
  wählt nie einen verworfenen Kandidaten, vergibt nicht für alle Kandidaten denselben Score und
  exportiert eine JPEG-Datei unter dem 2-MB-Limit von YouTube.
* TEST_MODE ist als solcher markiert (`test_mode`, `image_model: mock-image-model`,
  `critique_source: deterministic-mock`, Abweichungseintrag pro Bild) und kann nicht als echter
  Lauf missverstanden werden.
* Kostenschätzung skaliert korrekt mit Qualität, Größe, Modell und Anzahl.

### Unbelegt / offen
* Ob echte Sunburst-Bilder in `max` bei 2560x1440 tatsächlich geliefert werden.
* Ob die Vision-Kritik brauchbare Urteile über echte Fotos fällt (im TEST_MODE antwortet ein
  Messverfahren, kein Modell).
* Ob die erzeugten Thumbnails professionell wirken, sich im Feed durchsetzen oder ohne Nacharbeit
  verwendbar sind.
* Reale Latenz und reale Kosten pro Job.
* Ob `images.edit` mit den 2.5-Modellen die gewünschte gezielte Korrektur liefert.
* Die Modell-IDs (`gpt-image-2.5-sunburst`, `gpt-6-astra`) stammen aus der Vorgabe und der
  Dokumentationsrecherche; ihre Verfügbarkeit für einen konkreten Account ist ungeprüft
  (`supportsModel()` prüft das zur Laufzeit).

---

## 7. Verbleibende Einschränkungen

* `.docx`/`.pdf`-Parser fehlen weiterhin (Registry ist vorbereitet).
* Der Gemini-Bildprovider bleibt bewusst unimplementiert.
* Schlägt die Stufe-1-QA bei **allen** Kandidaten fehl, wird der beste trotzdem verwendet — mit
  ausdrücklicher Warnung im Log. Der Job bricht nicht ab.
* Die Kostenwächter verwenden einen persistenten Tagesspeicher; mehrere Benchmarks am selben Tag
  können das Tageslimit erreichen (dann `MAX_COST_PER_DAY` erhöhen).
* Es wird bewusst **keine Verbesserungsquote in Prozent** angegeben: dafür hätte es einen
  kontrollierten Vergleich mit echten API-Bildern vorher/nachher gebraucht, der ohne Zugangsdaten
  nicht möglich war.
