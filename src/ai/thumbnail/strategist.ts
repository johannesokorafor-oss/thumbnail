import type { TextProvider } from '../providers/types.js';
import type {
  ChannelProfile, DesignScore, ScriptAnalysis, ThumbnailConcept, TextPosition, StylePreset, ThumbnailStrategy,
} from '../../types/index.js';
import { THUMBNAIL_STRATEGIES } from '../../types/index.js';
import { CONCEPTS_SCHEMA, SELECTION_SCHEMA, TEXT_SCHEMA } from '../schemas.js';

/** Weighting of the internal, purely visual design score (section 6). */
export const SCORE_WEIGHTS: Record<keyof DesignScore, number> = {
  ATTENTION: 1.2,
  CURIOSITY: 1.2,
  INSTANT_COMPREHENSION: 1.1,
  EMOTIONAL_IMPACT: 1.0,
  VISUAL_CLARITY: 1.1,
  SUBJECT_PROMINENCE: 1.1,
  COMPOSITION: 1.0,
  CONTRAST: 1.0,
  COLOR_DIVERSITY: 0.6,
  SMALL_SCREEN_READABILITY: 1.2,
  TITLE_ALIGNMENT: 1.0,
  NOVELTY: 0.8,
  CLICK_INTENT: 1.0,
  CONTENT_ACCURACY: 1.3,
  VISUAL_SIMPLICITY: 0.9,
};

const EMPTY_SCORE: DesignScore = Object.fromEntries(
  Object.keys(SCORE_WEIGHTS).map((k) => [k, 5]),
) as unknown as DesignScore;

export function normalizeScore(raw: unknown): DesignScore {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY_SCORE };
  for (const key of Object.keys(SCORE_WEIGHTS) as (keyof DesignScore)[]) {
    const alt = key === 'SMALL_SCREEN_READABILITY' ? src['SMALL-SCREEN_READABILITY'] : undefined;
    const n = Number(src[key] ?? alt);
    out[key] = Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 5;
  }
  return out;
}

/** Weighted 0–10 design score. Internal technical metric only. */
export function computeScoreTotal(score: DesignScore): number {
  let sum = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(SCORE_WEIGHTS) as [keyof DesignScore, number][]) {
    sum += score[key] * w;
    weight += w;
  }
  return Number((sum / weight).toFixed(2));
}

const VALID_POSITIONS: TextPosition[] = ['LEFT_TEXT', 'RIGHT_TEXT', 'TOP_TEXT', 'BOTTOM_TEXT', 'CENTER_TEXT'];

function normPosition(v: unknown, fallback: TextPosition = 'RIGHT_TEXT'): TextPosition {
  const s = String(v ?? '').toUpperCase().replace(/[\s-]/g, '_');
  const withSuffix = s.endsWith('_TEXT') ? s : `${s}_TEXT`;
  return (VALID_POSITIONS.find((p) => p === s || p === withSuffix) ?? fallback) as TextPosition;
}

const STRATEGIST_SYSTEM = `Du bist THUMBNAIL STRATEGIST für einen professionellen YouTube-Kanal.
Du arbeitest wie ein Art Director, der täglich Thumbnails mit Millionen Impressionen verantwortet.

Deine Aufgabe ist NICHT, das Skript abzubilden, sondern die visuell und emotional stärkste Idee herauszuarbeiten.

Arbeitsweise:
1. Bestimme zuerst den stärksten visuellen Hook des Skripts: den dramatischsten Moment, den größten
   Widerspruch, die überraschendste Tatsache, die stärkste Transformation oder das größte Rätsel.
2. Entwickle daraus Konzepte, die jeweils eine ANDERE visuelle Strategie verfolgen.

Harte Regeln:
- Jedes Konzept muss eine andere STRATEGY verwenden. Keine zwei Konzepte mit derselben Strategie.
- Zwei Konzepte dürfen nicht dasselbe Bild mit anderen Worten sein: Hauptmotiv, Bildausschnitt,
  Perspektive, Lichtsituation und Bildidee müssen sich deutlich unterscheiden.
- Springe niemals automatisch auf die offensichtlichste Szene ("alter Mann im Labor").
- Jedes Konzept hat genau EINEN klaren Hauptfokus und eine bewusst freigehaltene Textfläche.
- Beschreibe das Motiv konkret und bildhaft (was genau sieht man, in welchem Moment, mit welchem
  Gesichtsausdruck, in welchem Licht) - keine vagen Wortwolken.
- Alles muss durch das Skript gedeckt sein. Symbolik ist erlaubt, erfundene Tatsachenbehauptungen nicht.
- Thumbnail-Texte: 2-6 Wörter, natürliche Sprache des Skripts, nicht identisch mit dem Videotitel.
- Antworte ausschließlich mit gültigem JSON.

Verfügbare Strategien:
SUBJECT_CLOSEUP    - extreme Nähe zu einem Gesicht oder einer Hero-Oberfläche
DRAMATIC_SCENE     - entscheidender Moment einer Handlung, weiter inszeniert
MYSTERY_REVEAL     - etwas ist teilweise verdeckt, ein Detail wird freigegeben
HUMAN_EMOTION      - eine große, eindeutige menschliche Reaktion
SYMBOLIC_METAPHOR  - grafisch-editoriale Idee, ein surreales Element in realer Szene
OBJECT_HERO        - ein Objekt wird monumental inszeniert
CONTRAST_SPLIT     - zwei gegensätzliche Realitäten in einem Bild, ohne harte Trennlinie
SCALE_SHIFT        - extremes Größenverhältnis als eigentliche Bildaussage`;

export interface ConceptOptions {
  provider: TextProvider;
  analysis: ScriptAnalysis;
  profile: ChannelProfile;
  conceptCount: number;
  jobId: string;
  referenceStyle?: string;
}

/** Assigns a strategy, guaranteeing that no two concepts share one. */
function pickStrategy(raw: unknown, used: Set<ThumbnailStrategy>, index: number): ThumbnailStrategy {
  const normalized = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '_') as ThumbnailStrategy;
  if (THUMBNAIL_STRATEGIES.includes(normalized) && !used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  const free = THUMBNAIL_STRATEGIES.filter((s) => !used.has(s));
  const chosen = free[index % Math.max(free.length, 1)] ?? THUMBNAIL_STRATEGIES[index % THUMBNAIL_STRATEGIES.length];
  used.add(chosen);
  return chosen;
}

export async function generateConcepts(opts: ConceptOptions): Promise<ThumbnailConcept[]> {
  const { provider, analysis, profile, conceptCount, jobId } = opts;
  const user = `Entwickle ${conceptCount} grundverschiedene Thumbnail-Konzepte für dieses Video.

SKRIPTANALYSE:
${JSON.stringify(analysis, null, 2)}

KANALPROFIL:
${JSON.stringify(profile, null, 2)}
${opts.referenceStyle ? `\nABSTRAKTE STILREFERENZ (nicht kopieren, nur Richtung):\n${opts.referenceStyle}\n` : ''}
Videotitel: "${analysis.VIDEO_TITLE}"
Titel = Kontext, Thumbnail = visueller Hook. Der Thumbnail-Text darf den Titel nicht wiederholen.

Bestimme zuerst den stärksten visuellen Hook und entwickle dann ${conceptCount} Konzepte mit
JEWEILS UNTERSCHIEDLICHER STRATEGY aus dieser Liste:
${THUMBNAIL_STRATEGIES.join(', ')}

Liefere JSON:
{
  "strongestHook": "ein Satz: was ist der visuell stärkste Moment des Skripts",
  "concepts": [
    {
      "id": "C1",
      "strategy": "<eine der Strategien>",
      "label": "kurzer Name des Konzepts",
      "idea": "ein Satz: was sieht man",
      "subject": "das Hauptmotiv sehr konkret beschrieben",
      "emotion": "Gesichtsausdruck / Körpersprache / emotionale Intensität (falls Menschen vorkommen)",
      "action": "der eingefrorene Moment",
      "environment": "Umgebung mit den 2-3 wichtigsten Details",
      "era": "Zeit / Kontext",
      "composition": "Bildaufbau, Platzierung des Motivs, Vorder-/Hintergrundhierarchie",
      "camera": "Brennweite, Perspektive, Schärfentiefe",
      "lighting": "Lichtrichtung, Härte, Kontrast, Atmosphäre",
      "color": "Farbpalette mit einem dominanten Akzent",
      "mood": "Stimmung",
      "depth": "Tiefenwirkung",
      "detail": "die wenigen Details, die bei 320px noch zählen",
      "visualMetaphor": "die Bildidee dahinter",
      "textArea": "LEFT_TEXT | RIGHT_TEXT | TOP_TEXT | BOTTOM_TEXT | CENTER_TEXT",
      "style": "einer der Stilwerte des Kanalprofils oder der Analyse",
      "thumbnailText": "2-6 Wörter",
      "unusual": true/false,
      "rationale": "warum dieses Bild bei 320px funktioniert",
      "score": { alle 15 Kriterien 0-10 }
    }
  ]
}

score-Kriterien: ATTENTION, CURIOSITY, INSTANT_COMPREHENSION, EMOTIONAL_IMPACT, VISUAL_CLARITY,
SUBJECT_PROMINENCE, COMPOSITION, CONTRAST, COLOR_DIVERSITY, SMALL_SCREEN_READABILITY,
TITLE_ALIGNMENT, NOVELTY, CLICK_INTENT, CONTENT_ACCURACY, VISUAL_SIMPLICITY.`;

  const { value } = await provider.completeJson<{ concepts: Record<string, unknown>[] }>({
    system: STRATEGIST_SYSTEM,
    user,
    jsonSchemaName: 'thumbnail_concepts',
    schema: CONCEPTS_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 6000,
    jobId,
  });

  const usedStrategies = new Set<ThumbnailStrategy>();
  const concepts = (value.concepts ?? []).map((c, i) => {
    const score = normalizeScore(c.score);
    const str = (k: string, fb = '') => (typeof c[k] === 'string' && (c[k] as string).trim() ? (c[k] as string).trim() : fb);
    const concept: ThumbnailConcept = {
      id: str('id', `C${i + 1}`),
      label: str('label', `Konzept ${i + 1}`),
      strategy: pickStrategy(c.strategy, usedStrategies, i),
      idea: str('idea'),
      subject: str('subject'),
      emotion: str('emotion'),
      action: str('action'),
      environment: str('environment'),
      era: str('era'),
      composition: str('composition'),
      camera: str('camera'),
      lighting: str('lighting'),
      color: str('color'),
      mood: str('mood'),
      depth: str('depth'),
      detail: str('detail'),
      visualMetaphor: str('visualMetaphor'),
      textArea: normPosition(c.textArea, VALID_POSITIONS[i % VALID_POSITIONS.length]),
      style: (String(c.style ?? analysis.SUGGESTED_STYLE).toUpperCase().replace(/[\s-]/g, '_') as StylePreset) || analysis.SUGGESTED_STYLE,
      thumbnailText: str('thumbnailText', analysis.THUMBNAIL_TEXT_CANDIDATES[i] ?? ''),
      unusual: Boolean(c.unusual),
      rationale: str('rationale'),
      score,
      scoreTotal: computeScoreTotal(score),
    };
    return concept;
  });

  return concepts;
}

/**
 * Pick the strongest N concepts while guaranteeing real visual diversity:
 * no repeated strategy, no repeated text area, at least one unusual idea.
 */
export function selectTopConcepts(concepts: ThumbnailConcept[], count: number): ThumbnailConcept[] {
  const sorted = [...concepts].sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0));
  const picked: ThumbnailConcept[] = [];
  const usedStrategies = new Set<string>();
  const usedAreas = new Set<TextPosition>();

  // Pass 1: strongest concept per unused strategy.
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (usedStrategies.has(c.strategy)) continue;
    picked.push(c);
    usedStrategies.add(c.strategy);
    usedAreas.add(c.textArea);
  }
  // Pass 2: fill remaining slots, preferring unused text areas.
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (picked.includes(c) || usedAreas.has(c.textArea)) continue;
    picked.push(c);
    usedAreas.add(c.textArea);
  }
  // Pass 3: fill whatever is left.
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (!picked.includes(c)) picked.push(c);
  }
  // Guarantee at least one deliberately unusual concept.
  if (picked.length && !picked.some((c) => c.unusual)) {
    const unusual = sorted.find((c) => c.unusual && !picked.includes(c));
    if (unusual) picked[picked.length - 1] = unusual;
  }
  // Spread text areas so the candidates differ in layout too.
  const areas: TextPosition[] = ['RIGHT_TEXT', 'LEFT_TEXT', 'BOTTOM_TEXT', 'TOP_TEXT', 'CENTER_TEXT'];
  const seen = new Set<TextPosition>();
  const spread = picked.map((c) => {
    if (!seen.has(c.textArea)) {
      seen.add(c.textArea);
      return c;
    }
    const free = areas.find((a) => !seen.has(a));
    if (!free) return c;
    seen.add(free);
    return { ...c, textArea: free };
  });
  return spread.slice(0, count);
}

/** How different are two concepts? 0 = identical idea, 1 = completely different. */
export function conceptDistance(a: ThumbnailConcept, b: ThumbnailConcept): number {
  const tokens = (c: ThumbnailConcept) =>
    new Set(
      `${c.subject} ${c.composition} ${c.camera} ${c.environment} ${c.visualMetaphor}`
        .toLowerCase()
        .replace(/[^\p{L}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 4),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (ta.size + tb.size - shared);
  const strategyPenalty = a.strategy === b.strategy ? 0.35 : 0;
  const areaPenalty = a.textArea === b.textArea ? 0.1 : 0;
  return Math.max(0, 1 - jaccard - strategyPenalty - areaPenalty);
}

export interface ThumbnailTextOptions {
  provider: TextProvider;
  analysis: ScriptAnalysis;
  concept: ThumbnailConcept;
  profile: ChannelProfile;
  jobId: string;
}

/** Final short thumbnail text (sections 8 & 53). */
export async function generateThumbnailText(opts: ThumbnailTextOptions): Promise<{ text: string; reason: string }> {
  const { provider, analysis, concept, profile, jobId } = opts;
  const { value } = await provider.completeJson<{ text: string; reason?: string }>({
    system: `Du schreibst Thumbnail-Texte für einen deutschsprachigen YouTube-Kanal.
Regeln: 2–${profile.max_text_words} Wörter, natürliches Deutsch, kein Denglisch, keine schlechte Übersetzung,
kein künstlicher Marketington, inhaltlich vom Skript gedeckt, nicht identisch mit dem Videotitel,
sofort verständlich, neugierig machend. Antworte nur mit JSON.`,
    user: `Videotitel: ${analysis.VIDEO_TITLE}
Kernthese: ${analysis.CORE_THESIS}
Primärer Hook: ${analysis.PRIMARY_HOOK}
Emotionaler Kern: ${analysis.EMOTIONAL_CORE}
Schlüsselfrage: ${analysis.KEY_QUESTION}
Gewähltes Bildkonzept: ${concept.label} – ${concept.idea}
Belegte Aussagen: ${analysis.FACTUAL_STATEMENTS.slice(0, 5).join(' | ')}
Bisherige Kandidaten: ${analysis.THUMBNAIL_TEXT_CANDIDATES.join(' | ')}

Liefere: { "text": "...", "reason": "..." }`,
    jsonSchemaName: 'thumbnail_text',
    schema: TEXT_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 500,
    jobId,
  });

  let text = (value.text ?? '').trim().replace(/^["„»]|["“«]$/g, '');
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > Math.max(profile.max_text_words + 2, 6)) {
    text = words.slice(0, Math.max(profile.max_text_words, 5)).join(' ');
  }
  if (!text) text = concept.thumbnailText || analysis.THUMBNAIL_TEXT_CANDIDATES[0] || 'MEHR DAHINTER';
  return { text: text.toUpperCase(), reason: value.reason ?? '' };
}

export interface SelectionOptions {
  provider: TextProvider;
  jobId: string;
  analysis: ScriptAnalysis;
  summaries: Array<{ index: number; concept: string; critique: string; scoreTotal: number }>;
}

/** Final variant selection with a short, factual reason (section 57). */
export async function selectBestVariant(opts: SelectionOptions): Promise<{ selectedIndex: number; reason: string }> {
  const { provider, summaries, analysis, jobId } = opts;
  if (!summaries.length) throw new Error('Keine Varianten zur Auswahl vorhanden.');
  const { value } = await provider.completeJson<{ selectedIndex: number; reason: string }>({
    system: `Du bist FINALIZER. Wähle die Variante mit der stärksten Gesamtwirkung als YouTube-Thumbnail.
Bewertungsgrundlage: Aufmerksamkeit, Klarheit, Neugier, Komposition, Kleinansicht-Lesbarkeit, Titelabstimmung, inhaltliche Korrektheit.
Nimm nicht automatisch die erste Variante. Begründe kurz und sachlich. Nur JSON.`,
    user: `Videotitel: ${analysis.VIDEO_TITLE}

Varianten:
${summaries.map((s) => `#${s.index} (Score ${s.scoreTotal})\nKonzept: ${s.concept}\nKritik: ${s.critique}`).join('\n\n')}

Liefere: { "selectedIndex": <Nummer>, "reason": "kurze sachliche Begründung" }`,
    jsonSchemaName: 'final_selection',
    schema: SELECTION_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 500,
    jobId,
  });

  const valid = summaries.map((s) => s.index);
  const chosen = valid.includes(Number(value.selectedIndex))
    ? Number(value.selectedIndex)
    : summaries.slice().sort((a, b) => b.scoreTotal - a.scoreTotal)[0].index;
  return { selectedIndex: chosen, reason: value.reason || 'Höchster technischer Design-Score über alle Kriterien.' };
}
