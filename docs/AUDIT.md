# Audit vor der Qualitätsüberarbeitung

Stand: Commit `0677a05`. Jede Aussage wurde am Code verifiziert, nicht aus früheren Statusberichten übernommen.

## Was tatsächlich implementiert war

| Frage | Befund | Beleg |
|---|---|---|
| Welche OpenAI-API? | Images API (`openai.images.generate`) für Bilder, Responses API (`openai.responses.create`) für Analyse/Kritik, offizielles SDK v7 | `src/ai/providers/openai/imageProvider.ts:88`, `textProvider.ts:79` |
| Welches Modell wird angefragt? | `cfg.imageModel` (= `gpt-image-2.5-sunburst`) – **aber** `resolveModel()` tauscht still auf Flare, wenn `models.list()` die ID nicht enthält | `imageProvider.ts:49-63` |
| Welche Qualität wird angefragt? | Im Realbetrieb **nicht** `IMAGE_QUALITY`, sondern `qualityModeSettings(mode).quality`; die Nutzereinstellung war wirkungslos | `pipeline.ts:99` |
| Welche Größe wird angefragt? | `2560x1440` – Fallbackkette danach `1536x1024`, `1792x1024`, `auto` | `imageProvider.ts:10` |
| Kommt ein echtes Bild von OpenAI? | Ja, `b64_json` wird dekodiert, kein Platzhalter | `imageProvider.ts:100-110` |
| Bekommt der Critic echte Pixel? | Ja, als `input_image`-Data-URL – **aber** das volle 2560x1440-PNG (~10 MB Base64 pro Request) | `textProvider.ts:52-58`, `imageCritic.ts:52` |
| Werden Kandidaten visuell verglichen? | **Nein.** Die Endauswahl bekam nur Textzusammenfassungen | `pipeline.ts:285`, `strategist.ts:selectBestVariant` |
| Ist das finale Bild das echte generierte Bild? | Ja | `pipeline.ts` (CLEAN_ART = Datei der gewählten Variante) |
| Umgeht TEST_MODE qualitätskritische Logik? | Ja: Mock-Critic ignoriert die Pixel und liefert konstante Scores (jede Variante 7.93), Mock-Auswahl immer Index 1 | `mock/index.ts:185-210` |
| Ist der Export direkt verwendbar? | Formal ja (16:9, exakte Größe, sauberes JPEG) – praktisch riskant, s. Lücke 2 | `normalize.ts`, `qa.ts` |
| Gibt es stille Qualitätsabstufungen? | Ja, bei Modell, Qualität und Größe – jeweils nur `logger.warn` | `imageProvider.ts:117-137` |

## Dokumentierte Lücken (Stand vor der Überarbeitung)

1. **Stille Premium-Degradierung.** Sunburst → Flare, `max` → `xhigh`/`high`/`medium` und Größenwechsel liefen als Warnung durch; der Job galt trotzdem als erfolgreich. Ein „Premium“-Ergebnis konnte in Wahrheit Flare/medium sein.
2. **Nicht-16:9-Fallbackgrößen + Zwangszuschnitt.** `1536x1024` ist 3:2, `1792x1024` ist 7:4. Anschließend `resize(fit:'cover', position:'attention')` → ungewollter Beschnitt der Komposition, genau das, was ein Thumbnail ruiniert (abgeschnittene Köpfe, zerstörte Textfläche).
3. **Keine visuelle Endauswahl.** Die stärkste Variante wurde aus Textzusammenfassungen gewählt, nicht aus einem Bildvergleich.
4. **Keine Stage-1-QA pro Kandidat.** QA lief genau einmal – auf dem fertig komponierten Endbild. Schlechte Kandidaten konnten nicht vorher ausgeschlossen werden.
5. **Keine Kleinformat-Prüfung pro Kandidat.** Nur eine 320px-Datei am Ende. Ein Bild, das in Originalgröße gut aussieht, aber bei 320px zerfällt, wurde nicht erkannt.
6. **Critic-Input ineffizient und ohne Kleinformat.** Volles PNG pro Request; der Critic sah nie die verkleinerte Fassung, sollte aber Kleinformat-Lesbarkeit beurteilen.
7. **Prompt überrestringiert.** ~20 Negativanweisungen plus Profilverbote, teils widersprüchlich („no borders“ + „cinematic“), wenig konkrete Bildregie. Die OpenAI-Dokumentation rät ausdrücklich davon ab, das Modell mit widersprüchlichen Anweisungen zu überladen.
8. **Konzeptvielfalt nicht erzwungen.** Nur `textArea` wurde als Diversitätskriterium genutzt; fünf Konzepte konnten faktisch dieselbe Bildidee sein.
9. **Kein Refinement-Pfad.** `images.edit` (von Sunburst unterstützt) wurde nur für Referenzbilder benutzt, nicht für gezielte Korrekturen am Sieger.
10. **Textposition ohne Bildbezug.** Die Safe Area kam aus dem Konzept, nicht aus dem tatsächlich erzeugten Bild – Text konnte auf dem Hauptmotiv landen.
11. **Regenerations-Bug.** `resumeFrom: 'overlay'` (Button „CHANGE TEXT“) durchlief trotzdem die komplette Bildgenerierung → volle API-Kosten für eine reine Textänderung.
12. **Kostenschätzung nicht kalibriert.** Pauschale Preistabelle ohne Bezug zu den publizierten Token-Preisen ($30/M Output-Token).
13. **Kein echter API-E2E-Test.** Nur der TEST_MODE-Lauf mit Platzhaltergrafik.

## Verbindliche API-Fakten (aus der aktuellen OpenAI-Dokumentation geprüft)

* Modelle: `gpt-image-2.5-sunburst` (Basis, Qualitätsfokus), `gpt-image-2.5-flare` (klein, Geschwindigkeit).
* `quality`: `auto | low | medium | high | xhigh | max`.
* `size`: `auto` oder `WIDTHxHEIGHT`; **beide Kanten Vielfache von 16**, Seitenverhältnis zwischen 1:3 und 3:1, keine Kante > 3840 px, Gesamtpixel zwischen 655.360 und 8.294.400. Ausgaben über 3.686.400 px (= `2560x1440`) sind laut Doku experimentell.
* `images.edit` unterstützt dieselben Modelle (Grundlage für gezieltes Refinement).
* Bildantwort kommt als `b64_json`.

Diese Werte sind jetzt in `src/image/size.ts` und `src/config/index.ts` als einzige Quelle hinterlegt.
