# Qualitäts-Audit (Stand 2026-09-30)

Grundlage: Lesen des tatsächlichen Codes, nicht früherer Berichte. Bewertung je
Merkmal:

| Stufe | Bedeutung |
| --- | --- |
| **A** | implementiert und an echten Pixeln verifiziert |
| **B** | implementiert, aber nur über Mock/synthetische Tests abgedeckt |
| **C** | implementiert, nicht getestet |
| **D** | in Dokumentation behauptet, im Code nicht vorhanden |
| **E** | fehlt vollständig |

**Rahmenbedingung, die alles begrenzt:** In dieser Umgebung existiert kein
`OPENAI_API_KEY` und kein Netzzugang zu `api.openai.com`. Kein Merkmal, das von
echter Bildgenerierung abhängt, kann Stufe A erreichen. Das betrifft
insbesondere jede Aussage über Motivqualität, Konzeptvielfalt und
Prompt-Wirksamkeit.

## Befunde je Komponente

| Komponente | Stufe | Befund |
| --- | --- | --- |
| OpenAI-Client / Provider-Abstraktion | B | Offizielles SDK, `ImageProvider`-Interface, Mock- und OpenAI-Provider. Nie gegen die echte API gelaufen. |
| Bildgrößen-Logik (`src/image/size.ts`) | B | Alle dokumentierten Grenzen erzwungen: Vielfache von 16, ≤3840 px, ≤3:1, Pixelfenster, 16:9-Leiter. `1920x1080` ist strukturell ausgeschlossen. Gut getestet (`tests/size.test.ts`). |
| Qualitätsmodi FAST/BALANCED/MAX | C | Getrennte Profile für Varianten, Kritiktiefe, Verfeinerung, Fallback-Politik. |
| Fallback-Ehrlichkeit | C | `degradations[]` wird pro Bild geführt, protokolliert und in die Metadaten geschrieben; Fallbacks sind pro Modus abschaltbar. Im Echtbetrieb nie ausgelöst worden. |
| Skriptanalyse / Hook-Findung | B | Strukturierte Analyse mit Hook-Kandidaten; Qualität der Auswahl hängt am echten Modell. |
| Konzeptgenerierung / Diversität | B | 8 Strategien, Auswahl erzwingt unterschiedliche Strategien. Ob echte Bilder wirklich verschieden ausfallen: unbelegt. |
| Prompt-Builder | B | Strukturiert nach Subjekt/Komposition/Licht/Farbe/Textfläche; `SUBJECT_SCALE` je Strategie; Widerspruchsfilter für Platzierungsangaben; AVOID-Liste gedeckelt. Wirksamkeit unbelegt. |
| Lokale Pixel-QA (Stage 1) | A | 11 deterministische Prüfungen an echten Dateien, inklusive 320px-Verhalten. |
| **QA am Gesamtbild** | **A** | **Neu.** Siehe Befund 1 unten. |
| Visueller Kritiker (Stage 2) | B | Sendet echte Pixel (Vollbild + 320px) und liefert strukturierte Gründe. Im TEST_MODE nur ein Pixelmaß. |
| Direktvergleich / Ranking | B | Vergleicht Bilder, nicht Beschreibungen; begründet je Kandidat. |
| **Bewertungsgegenstand** | **A** | **Neu.** Siehe Befund 2 unten. |
| Gesamtablehnung | B | `REJECTED` + `REJECTION_REPORT.json`, kein Export, in der Oberfläche sichtbar; durch `tests/qualityGate.test.ts` belegt. |
| Verfeinerung | B | Nur MAX, nur bei konkretem Defekt, danach erneute QA **und** erneute Kritik; Rückfall auf das Original. |
| Textplatzierung | A | Inhaltsabhängig, überschreibt die Konzeptvorgabe bei Kollision; an echten Exporten nachgewiesen. |
| Akzentfarbe | A | Histogrammbasiert; nachgewiesen, dass sie nicht mehr auf dem Motivfarbton landet. |
| Textmessung | B | Gemessene Renderbreite, kein Zeichenzählen. |
| Export / Kompression | A | 16:9, gültige Maße, JPEG unter 2 MB, kein Rahmenartefakt. |
| **Sichtprüfungs-Ansichten 1280/640/320** | **A** | **Neu.** Siehe Befund 3 unten. |
| Platzhalter-Kennzeichnung | A | `NICHT_VEROEFFENTLICHEN.txt`, `publishable: false` im TEST_MODE. |
| Watcher / Queue / Retry / Duplikate | B | Funktionsfähig, durch Tests abgedeckt. |
| Oberfläche (Review-Modus) | C | Zeigt alle Kandidaten, Ranking-Begründung und Ablehnung mit Erklärung. |
| Benchmark-Runner | C | Vorhanden, nur im TEST_MODE gelaufen. |
| Echte API-Strecke | **E (nicht ausführbar)** | Kein Schlüssel, kein Netz. `npm run e2e:real -- --all` steht bereit. |

## Drei echte Defekte, die dieses Audit gefunden und behoben hat

### 1. Die Textflächen-Prüfung konnte am Gesamtbild niemals bestehen

`text_safe_area` misst die Detaildichte in der Textzone. Am fertigen Bild ist
die Schrift selbst diese Detaildichte — die Prüfung schlug damit für **jeden**
Kandidaten fehl (gemessen: 1.19x bei Grenze 1.05, bei allen vier Varianten).
Eine Prüfung, die immer fehlschlägt, ist kein Qualitätssignal, sondern Rauschen.

Behoben durch `mode: 'artwork' | 'composite'`: Am Artwork wird weiterhin die
freie Fläche geprüft, am Gesamtbild stattdessen die **Lesbarkeit** — der
Kontrastumfang der Textzone, gemessen bei 320px Breite. Die Prüfung
unterscheidet jetzt tatsächlich: weißer Text auf dunklem Grund besteht
(241–249 Stufen), heller Text auf hellem Grund fällt durch.

### 2. Bewertet wurde das Artwork, nicht das Thumbnail

Lokale QA, Kritik, Ranking und Qualitätsschwelle liefen auf `VARIANT_xx.png` —
dem **nackten Bild ohne Schrift**. Der Text wurde erst danach auf den bereits
gekürten Sieger gesetzt. Damit bewertete das System ein Bild, das niemand je zu
sehen bekommt, und Urteile wie „textsichere Komposition" oder „bei kleiner
Größe lesbar" bezogen sich auf etwas anderes als das Endprodukt.

Behoben: Jeder Kandidat wird direkt nach der Generierung komponiert
(`VARIANT_xx_COMPOSITE.png`), und Kritik, Direktvergleich und
Kleinbild-Prüfung arbeiten auf dem Gesamtbild. Die Platzierung wird dabei je
Kandidat einzeln entschieden — im Testlauf nachgewiesen: Varianten 1–3
`TOP_TEXT` mit erzwungener Kontrastfläche, Variante 4 `RIGHT_TEXT` bei 0%
Motivüberlappung. Kein festes Schema. **Die Zahl der API-Aufrufe bleibt
unverändert**, es wird nur das richtige Bild bewertet.

### 3. Kleinbild-Prüfung nur für das Endbild

Jetzt schreibt die Pipeline `INSPECTION/` mit **1280/640/320** für das Endbild
*und* jeden unterlegenen Kandidaten, plus Prüffragen. Die Kleinbildprüfung
unterscheidet messbar zwischen Kandidaten (Varianten 2 und 3 verlieren bei
320px den Fokus, 1 und 4 nicht).

## Was weiterhin unbelegt bleibt

1. Jede Aussage über **Motivqualität** echter Bilder.
2. Ob die Prompt-Änderungen bessere Bilder erzeugen.
3. Ob vier echte Kandidaten wirklich verschieden ausfallen.
4. Ob eine Verfeinerung in der Praxis verbessert.
5. Die Abnahmehürde selbst: *„ohne Nacharbeit hochladbar"*.

Ehrliche Gesamteinschätzung: Die **Entscheidungsmechanik** ist jetzt
nachweislich korrekt — sie bewertet das richtige Bild, mit Prüfungen, die
tatsächlich unterscheiden, und sie kann alles ablehnen. Ob die **Bilder** gut
sind, ist ohne API-Schlüssel nicht feststellbar und wird hier nicht behauptet.

---

## Übernahme-Verifikation (2026-09-30, zweiter Durchgang)

Der Arbeitsstand wurde bei Sitzungsbeginn auf den Initial-Commit zurückgesetzt
vorgefunden (`git log` zeigte nur `52f63a2 (grafted)`), während der Arbeitsbaum
die neueste Arbeit noch enthielt. Über `origin/arena/01a0eea1-thumbnail` wurde
der Index auf `7a6e31e` zurückgesetzt; der Arbeitsbaum stimmte danach exakt mit
dem gepushten Stand überein (0 abweichende Dateien). **Kein Codeverlust.**

Gegen den tatsächlichen Code geprüft, nicht gegen Berichte:

| Behauptung | Prüfung | Ergebnis |
| --- | --- | --- |
| Kritik bewertet das Gesamtbild | `imagePath: variant.compositeFile ?? variant.file` (Zeile 532) | bestätigt |
| Verfeinerung bewertet das Gesamtbild | `refinedComposite?.file ?? refinedFile` (Zeile 713) | bestätigt |
| Ranking vergleicht Gesamtbilder | `file: v.compositeFile ?? v.file` (Zeile 562) | bestätigt |
| Kleinbild-QA am Gesamtbild | `mode: 'composite'` (Zeile 455) | bestätigt |
| `text_safe_area` nur am Artwork | `if (mode === 'artwork')` (candidateQa Zeile 135) | bestätigt |
| `1920x1080` wird abgelehnt | `tests/size.test.ts` prüft genau das | bestätigt |
| MAX/BALANCED ohne stille Rückstufung | `allowQualityFallback/allowModelFallback: false` in beiden Profilen, nur FAST erlaubt sie | bestätigt |
| TEST_MODE nicht veröffentlichbar | `publishable: !cfg.testMode`, `NICHT_VEROEFFENTLICHEN.txt` | bestätigt |

**Gefundene Lücke:** Die Composite-First-Verdrahtung selbst war durch keinen
Test geschützt — `tests/composite.test.ts` prüfte nur die QA-Modi isoliert. Ein
Rückbau auf `variant.file` wäre unbemerkt durchgegangen, also genau der Fehler,
der schon einmal passiert ist. Geschlossen durch `tests/compositeFirst.test.ts`
(8 Tests): Gesamtbild je Kandidat vorhanden, **messbar verschieden vom
Artwork** (sonst liefe die Bewertung faktisch weiter am Artwork),
Lesbarkeitsprüfung statt Freiflächenprüfung, Platzierung je Kandidat begründet,
Ansichten bei 1280/640/320 inklusive unterlegener Kandidaten, 320er-Ansicht
wirklich 320x180, TEST_MODE als nicht veröffentlichbar markiert.

Ergänzt: Der Ablehnungsbericht nennt jetzt `evaluated_file`, die Platzierung
und fehlgeschlagene Gesamtbild-Prüfungen je Kandidat — die Ablehnung ist damit
am selben Bild nachvollziehbar, das bewertet wurde.

Teststand: **98 Tests in 14 Dateien, alle grün**; `tsc --noEmit` und Build sauber.
Unverändert offen bleibt alles aus „Was weiterhin unbelegt bleibt" — ohne
API-Schlüssel ist keine Aussage über echte Bildqualität möglich.
