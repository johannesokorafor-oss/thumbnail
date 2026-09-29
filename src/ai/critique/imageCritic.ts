import fsp from 'node:fs/promises';
import sharp from 'sharp';
import type { TextProvider } from '../providers/types.js';
import type {
  ScriptAnalysis,
  ThumbnailConcept,
  VariantCritique,
  VisualRanking,
} from '../../types/index.js';
import { CRITIQUE_SCHEMA, RANKING_SCHEMA, REFERENCE_STYLE_SCHEMA } from '../schemas.js';
import { computeScoreTotal, normalizeScore } from '../thumbnail/strategist.js';

/** Vision payloads are downscaled: full 2560x1440 PNGs would be ~10 MB of base64 per request. */
export async function visionPayload(file: string | Buffer, width = 1024, quality = 82): Promise<Buffer> {
  const input = typeof file === 'string' ? await fsp.readFile(file) : file;
  return sharp(input).resize(width, null, { withoutEnlargement: true }).jpeg({ quality }).toBuffer();
}

/** The reduced view the audience actually sees in the feed. */
export async function smallPreviewPayload(file: string | Buffer, width = 320): Promise<Buffer> {
  const input = typeof file === 'string' ? await fsp.readFile(file) : file;
  return sharp(input).resize(width, null, { withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
}

const CRITIC_SYSTEM = `Du bist IMAGE CRITIC, ein strenger Art Director für YouTube-Thumbnails.

Du bewertest ein tatsächlich generiertes Bild, nicht eine Beschreibung.
Du bekommst zwei Ansichten desselben Bildes: die große Fassung und die 320px-Feed-Vorschau.
Beurteile Lesbarkeit und Wirkung ausdrücklich auf Basis der kleinen Fassung.

Sei konkret und schonungslos. Benenne Defekte so, dass ein Bildbearbeiter sie beheben könnte.
Keine Höflichkeitsfloskeln, keine Wiederholung des Prompts, keine erfundenen Details.
Wenn das Bild generisch aussieht (Stockfoto-Gefühl, beliebiges KI-Bild), sage das deutlich.
Antworte ausschließlich mit gültigem JSON.`;

export interface CritiqueOptions {
  provider: TextProvider;
  imagePath: string;
  concept: ThumbnailConcept;
  analysis: ScriptAnalysis;
  jobId: string;
  depth?: 'light' | 'full';
}

/**
 * Visual critique of ONE candidate, performed on the real pixels
 * (full view + 320px view in the same request).
 */
export async function critiqueVariant(opts: CritiqueOptions): Promise<VariantCritique> {
  const { provider, imagePath, concept, analysis, jobId } = opts;
  const [full, small] = await Promise.all([visionPayload(imagePath), smallPreviewPayload(imagePath)]);

  const questions = `Beantworte für dieses Bild:
1. Was fällt zuerst ins Auge?
2. Was ist das Hauptmotiv und ist es sofort klar?
3. Ist die visuelle Hierarchie eindeutig oder konkurrieren mehrere Blickpunkte?
4. Erzeugt das Bild Neugier?
5. Emotionale Wirkung?
6. Komposition, Kontrast, Trennung Motiv/Hintergrund?
7. Funktioniert es in der 320px-Ansicht noch? Was geht verloren?
8. Ist der geplante Textbereich (${concept.textArea}) wirklich ruhig genug für eine Schlagzeile?
9. Ist das Bild überladen?
10. Wirkt es hochwertig und wie ein echtes professionelles Thumbnail - oder wie ein beliebiges KI-Bild?
11. Anatomische, perspektivische oder physikalische Fehler?
12. Artefakte, doppelte Objekte, unsinnige Details?
13. Passt das Bild zum Videothema, ohne etwas Falsches zu behaupten?`;

  const { value } = await provider.completeJson<Record<string, unknown>>({
    system: CRITIC_SYSTEM,
    user: `Videotitel: ${analysis.VIDEO_TITLE}
Thema: ${analysis.VIDEO_TOPIC}
Konzept: ${concept.label} [${concept.strategy}] - ${concept.idea}
Geplanter Textbereich: ${concept.textArea}

${questions}

Gib JSON zurück mit:
firstImpression, mainSubject, topicClear, createsCuriosity, hierarchyClear, textAreaSufficient,
textAreaLocation, overloaded, looksPremium, looksLikeRealThumbnail, feelsGeneric,
smallSizeVerdict, smallSizeReadable, visualContradictions[], anatomyOrPerspectiveErrors[],
artifacts[], defects[] (konkrete behebbare Mängel), fixableByEdit (true, wenn eine gezielte
Bildkorrektur reicht, false wenn die Bildidee selbst schwach ist), titleImageConnection,
reasons[] (3-6 strukturierte Begründungen für die Bewertung), score {15 Kriterien 0-10},
improvementPrompt (eine konkrete Anweisung für eine gezielte Korrektur), summary (ein Satz).`,
    images: [
      { data: full, label: 'ANSICHT 1 - volle Auflösung:' },
      { data: small, label: 'ANSICHT 2 - dieselbe Datei als 320px-Feed-Vorschau:' },
    ],
    jsonSchemaName: 'variant_critique',
    schema: CRITIQUE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 2500,
    jobId,
  });

  const score = normalizeScore(value.score);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
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
    feelsGeneric: value.feelsGeneric === true,
    smallSizeVerdict: String(value.smallSizeVerdict ?? ''),
    smallSizeReadable: value.smallSizeReadable !== false,
    visualContradictions: arr(value.visualContradictions),
    anatomyOrPerspectiveErrors: arr(value.anatomyOrPerspectiveErrors),
    artifacts: arr(value.artifacts),
    defects: arr(value.defects),
    fixableByEdit: value.fixableByEdit === true,
    titleImageConnection: String(value.titleImageConnection ?? ''),
    reasons: arr(value.reasons),
    score,
    scoreTotal: computeScoreTotal(score),
    improvementPrompt: String(value.improvementPrompt ?? ''),
    summary: String(value.summary ?? ''),
    source: provider.id === 'mock' ? 'deterministic-mock' : 'vision-model',
  };
}

export interface RankingOptions {
  provider: TextProvider;
  jobId: string;
  analysis: ScriptAnalysis;
  candidates: Array<{ index: number; file: string; conceptLabel: string; strategy: string }>;
}

/**
 * Head-to-head VISUAL comparison: all surviving candidates go into a single
 * request as real images, so the winner is chosen by looking at pictures —
 * not by comparing text summaries.
 */
export async function rankCandidatesVisually(opts: RankingOptions): Promise<VisualRanking> {
  const { provider, analysis, candidates, jobId } = opts;
  if (candidates.length === 1) {
    return {
      order: [candidates[0].index],
      winner: candidates[0].index,
      reason: 'Einziger Kandidat, der die lokale Qualitätsprüfung bestanden hat.',
      perCandidate: [{ index: candidates[0].index, verdict: 'Ohne Konkurrenz ausgewählt.' }],
      source: provider.id === 'mock' ? 'deterministic-mock' : 'vision-model',
    };
  }

  const images: Array<{ data: Buffer; label: string }> = [];
  for (const c of candidates) {
    const [full, small] = await Promise.all([visionPayload(c.file, 900), smallPreviewPayload(c.file)]);
    images.push({ data: full, label: `KANDIDAT ${c.index} (${c.strategy}) - volle Ansicht:` });
    images.push({ data: small, label: `KANDIDAT ${c.index} - 320px-Feed-Ansicht:` });
  }

  const { value } = await provider.completeJson<Record<string, unknown>>({
    system: `Du bist FINALIZER und wählst aus mehreren echten Thumbnail-Kandidaten den stärksten aus.
Du siehst jeden Kandidaten in voller Auflösung und als 320px-Feed-Vorschau.

Entscheide nach: sofortiger Lesbarkeit im Feed, Stärke des Hauptmotivs, Neugier, emotionaler Wirkung,
Komposition, Kontrast, Professionalität, Eigenständigkeit (nicht generisch) und Passung zum Videothema.
Ein technisch sauberes, aber langweiliges Bild verliert gegen ein mutiges, klares Bild.
Wähle nicht automatisch den ersten Kandidaten. Antworte nur mit JSON.`,
    user: `Videotitel: ${analysis.VIDEO_TITLE}
Thema: ${analysis.VIDEO_TOPIC}
Kernaussage: ${analysis.CORE_THESIS}

Kandidaten: ${candidates.map((c) => `#${c.index} = ${c.conceptLabel} [${c.strategy}]`).join(' | ')}

Vergleiche die Bilder direkt miteinander und liefere JSON:
{
  "order": [Kandidatennummern von stärkstem zu schwächstem],
  "winner": <Nummer>,
  "reason": "kurze sachliche Begründung, warum der Sieger im Feed am stärksten wirkt",
  "perCandidate": [{ "index": <Nummer>, "verdict": "ein Satz zur Bildwirkung" }]
}`,
    images,
    jsonSchemaName: 'visual_ranking',
    schema: RANKING_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 1200,
    jobId,
  });

  const valid = candidates.map((c) => c.index);
  const order = Array.isArray(value.order)
    ? (value.order as unknown[]).map(Number).filter((n) => valid.includes(n))
    : [];
  for (const idx of valid) if (!order.includes(idx)) order.push(idx);
  const winner = valid.includes(Number(value.winner)) ? Number(value.winner) : order[0];

  return {
    order,
    winner,
    reason: String(value.reason ?? 'Stärkste Gesamtwirkung im direkten Bildvergleich.'),
    perCandidate: Array.isArray(value.perCandidate)
      ? (value.perCandidate as Array<Record<string, unknown>>)
          .map((p) => ({ index: Number(p.index), verdict: String(p.verdict ?? '') }))
          .filter((p) => valid.includes(p.index))
      : [],
    source: provider.id === 'mock' ? 'deterministic-mock' : 'vision-model',
  };
}

/** Final check of the composed thumbnail (artwork + typography) at feed size. */
export async function finalCompositionCheck(opts: {
  provider: TextProvider;
  image: Buffer;
  jobId: string;
  thumbnailText: string;
  videoTitle: string;
}): Promise<{ approved: boolean; issues: string[]; notes: string }> {
  const [full, small] = await Promise.all([visionPayload(opts.image, 1024), smallPreviewPayload(opts.image)]);
  const { value } = await opts.provider.completeJson<Record<string, unknown>>({
    system: `Du prüfst ein FERTIG komponiertes YouTube-Thumbnail (Bild + eingesetzte Typografie).
Du siehst die große Fassung und die 320px-Feed-Vorschau. Antworte nur mit JSON.`,
    user: `Videotitel: ${opts.videoTitle}
Eingesetzter Thumbnail-Text: "${opts.thumbnailText}"

Prüfe: Ist der Text in der kleinen Ansicht sicher lesbar? Überdeckt er wichtige Bildteile
(Gesicht, Hauptmotiv)? Sitzt er sauber im Bild (keine Überlappung, kein Anschnitt, genug Rand)?
Wirkt die Gesamtkomposition professionell und upload-fertig?

Liefere JSON: { "approved": true/false, "issues": ["..."], "notes": "..." }`,
    images: [
      { data: full, label: 'Fertiges Thumbnail, volle Auflösung:' },
      { data: small, label: 'Dasselbe Thumbnail als 320px-Feed-Vorschau:' },
    ],
    jsonSchemaName: 'final_check',
    schema: {
      type: 'object',
      properties: {
        approved: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['approved'],
    },
    maxOutputTokens: 600,
    jobId: opts.jobId,
  });
  return {
    approved: value.approved !== false,
    issues: Array.isArray(value.issues) ? value.issues.map(String) : [],
    notes: String(value.notes ?? ''),
  };
}

/**
 * Derive an ABSTRACT style description from reference images.
 * Explicitly never a 1:1 copy — only compositional and tonal properties.
 */
export async function extractReferenceStyle(opts: {
  provider: TextProvider;
  imagePaths: string[];
  jobId: string;
}): Promise<string> {
  if (!opts.imagePaths.length) return '';
  const payloads = await Promise.all(opts.imagePaths.slice(0, 4).map((p) => visionPayload(p, 768)));
  const { value } = await opts.provider.completeJson<Record<string, unknown>>({
    system: `Du analysierst Referenz-Thumbnails ausschließlich abstrakt.
Beschreibe niemals konkrete Motive, Marken oder kopierbare Inhalte. Keine 1:1-Kopie fremder Werke.
Erlaubt sind nur: Komposition, Licht, visuelle Dichte, Farbstimmung, Bildsprache, Textplatzierung, Stil.
Antworte nur mit JSON.`,
    user: `Leite aus diesen Referenzbildern eine abstrakte Stilbeschreibung ab.
Gib JSON: { composition, lighting, visual_density, color_mood, imagery, text_placement, style_summary }`,
    images: payloads.map((data) => ({ data })),
    jsonSchemaName: 'reference_style',
    schema: REFERENCE_STYLE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 800,
    jobId: opts.jobId,
  });
  return [
    value.composition && `Komposition: ${value.composition}`,
    value.lighting && `Licht: ${value.lighting}`,
    value.visual_density && `Visuelle Dichte: ${value.visual_density}`,
    value.color_mood && `Farbstimmung: ${value.color_mood}`,
    value.imagery && `Bildsprache: ${value.imagery}`,
    value.text_placement && `Textplatzierung: ${value.text_placement}`,
    value.style_summary && `Zusammenfassung: ${value.style_summary}`,
  ]
    .filter(Boolean)
    .join('\n');
}
