import type { TextProvider } from '../providers/types.js';
import type { ScriptAnalysis, ThumbnailConcept, VariantCritique } from '../../types/index.js';
import { CRITIQUE_SCHEMA, MOBILE_CHECK_SCHEMA, REFERENCE_STYLE_SCHEMA } from '../schemas.js';
import { computeScoreTotal, normalizeScore } from '../thumbnail/strategist.js';

const CRITIC_SYSTEM = `Du bist IMAGE CRITIC, ein strenger Art Director für YouTube-Thumbnails.
Du bewertest ein generiertes Bild nüchtern und konkret – keine Höflichkeitsfloskeln.
Du bewertest ausschließlich visuelle und kommunikative Eigenschaften.
Antworte nur mit gültigem JSON.`;

export interface CritiqueOptions {
  provider: TextProvider;
  imagePath: string;
  concept: ThumbnailConcept;
  analysis: ScriptAnalysis;
  jobId: string;
  /** 'light' skips the deep artifact analysis (FAST quality mode). */
  depth?: 'light' | 'full';
}

/** Visual critique of one generated variant (section 15). */
export async function critiqueVariant(opts: CritiqueOptions): Promise<VariantCritique> {
  const { provider, imagePath, concept, analysis, jobId } = opts;
  const questions = `Beantworte für dieses Bild:
1. Was fällt zuerst ins Auge?
2. Was ist das Hauptmotiv?
3. Ist sofort klar, worum es ungefähr geht?
4. Erzeugt das Bild Neugier?
5. Ist die visuelle Hierarchie eindeutig?
6. Ist der Bildraum für Thumbnail-Text ausreichend und wo liegt er?
7. Ist das Bild zu überladen?
8. Wirkt das Bild hochwertig?
9. Wirkt es wie ein echtes professionelles YouTube-Thumbnail?
10. Gibt es visuelle Widersprüche?
11. Gibt es anatomische oder perspektivische Fehler?
12. Gibt es ungewollte Artefakte?
13. Ist die Verbindung zwischen Titel und Bild stark genug?`;

  const { value } = await provider.completeJson<Record<string, unknown>>({
    system: CRITIC_SYSTEM,
    user: `Videotitel: ${analysis.VIDEO_TITLE}
Konzept: ${concept.label} – ${concept.idea}
Geplanter Textbereich: ${concept.textArea}

${questions}

Gib JSON zurück mit: firstImpression, mainSubject, topicClear, createsCuriosity, hierarchyClear,
textAreaSufficient, textAreaLocation, overloaded, looksPremium, looksLikeRealThumbnail,
visualContradictions[], anatomyOrPerspectiveErrors[], artifacts[], titleImageConnection,
score {15 Kriterien 0–10}, improvementPrompt (konkrete Verbesserungsanweisung für eine erneute Generierung),
summary (ein Satz).`,
    images: [imagePath],
    jsonSchemaName: 'variant_critique',
    schema: CRITIQUE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 2500,
    jobId,
  });

  const score = normalizeScore(value.score);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    firstImpression: String(value.firstImpression ?? ''),
    mainSubject: String(value.mainSubject ?? ''),
    topicClear: value.topicClear !== false,
    createsCuriosity: value.createsCuriosity !== false,
    hierarchyClear: value.hierarchyClear !== false,
    textAreaSufficient: value.textAreaSufficient !== false,
    textAreaLocation: (String(value.textAreaLocation ?? concept.textArea) as VariantCritique['textAreaLocation']) ?? concept.textArea,
    overloaded: value.overloaded === true,
    looksPremium: value.looksPremium !== false,
    looksLikeRealThumbnail: value.looksLikeRealThumbnail !== false,
    visualContradictions: arr(value.visualContradictions),
    anatomyOrPerspectiveErrors: arr(value.anatomyOrPerspectiveErrors),
    artifacts: arr(value.artifacts),
    titleImageConnection: String(value.titleImageConnection ?? ''),
    score,
    scoreTotal: computeScoreTotal(score),
    improvementPrompt: String(value.improvementPrompt ?? ''),
    summary: String(value.summary ?? ''),
  };
}

/** 320px mobile readability check (section 41). */
export async function mobileReadabilityCheck(opts: {
  provider: TextProvider;
  imagePath: string;
  jobId: string;
  thumbnailText: string;
}): Promise<{ textReadable: boolean; subjectRecognizable: boolean; compositionClear: boolean; notes: string }> {
  const { value } = await opts.provider.completeJson<Record<string, unknown>>({
    system: 'Du prüfst eine stark verkleinerte Thumbnail-Vorschau (320px Breite). Antworte nur mit JSON.',
    user: `Das Bild ist die 320px-Vorschau eines Thumbnails mit dem Text "${opts.thumbnailText}".
Prüfe: Ist der Text noch erkennbar? Ist das Hauptmotiv noch erkennbar? Ist die Komposition noch klar?
Gib JSON: { textReadable, subjectRecognizable, compositionClear, notes }`,
    images: [opts.imagePath],
    jsonSchemaName: 'mobile_check',
    schema: MOBILE_CHECK_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 400,
    jobId: opts.jobId,
  });
  return {
    textReadable: value.textReadable !== false,
    subjectRecognizable: value.subjectRecognizable !== false,
    compositionClear: value.compositionClear !== false,
    notes: String(value.notes ?? ''),
  };
}

/**
 * Derive an ABSTRACT style description from reference images (section 17/34).
 * Explicitly never a 1:1 copy — only compositional and tonal properties.
 */
export async function extractReferenceStyle(opts: {
  provider: TextProvider;
  imagePaths: string[];
  jobId: string;
}): Promise<string> {
  if (!opts.imagePaths.length) return '';
  const { value } = await opts.provider.completeJson<Record<string, unknown>>({
    system: `Du analysierst Referenz-Thumbnails ausschließlich abstrakt.
Beschreibe niemals konkrete Motive, Marken oder kopierbare Inhalte. Keine 1:1-Kopie fremder Werke.
Erlaubt sind nur: Komposition, Licht, visuelle Dichte, Farbstimmung, Bildsprache, Textplatzierung, Stil.
Antworte nur mit JSON.`,
    user: `Leite aus diesen Referenzbildern eine abstrakte Stilbeschreibung ab.
Gib JSON: { composition, lighting, visual_density, color_mood, imagery, text_placement, style_summary }`,
    images: opts.imagePaths.slice(0, 4),
    jsonSchemaName: 'reference_style',
    schema: REFERENCE_STYLE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 800,
    jobId: opts.jobId,
  });
  const parts = [
    value.composition && `Komposition: ${value.composition}`,
    value.lighting && `Licht: ${value.lighting}`,
    value.visual_density && `Visuelle Dichte: ${value.visual_density}`,
    value.color_mood && `Farbstimmung: ${value.color_mood}`,
    value.imagery && `Bildsprache: ${value.imagery}`,
    value.text_placement && `Textplatzierung: ${value.text_placement}`,
    value.style_summary && `Zusammenfassung: ${value.style_summary}`,
  ].filter(Boolean);
  return parts.join('\n');
}
