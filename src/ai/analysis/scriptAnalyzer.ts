import type { ParsedScript } from '../../files/parser/index.js';
import { chunkScript } from '../../files/parser/index.js';
import type { TextProvider } from '../providers/types.js';
import type { ScriptAnalysis, StylePreset } from '../../types/index.js';
import { ANALYSIS_SCHEMA } from '../schemas.js';
import { logger } from '../../utils/logger.js';

const VALID_STYLES: StylePreset[] = [
  'CINEMATIC_DOCUMENTARY', 'PHOTOREALISTIC', 'MYSTERIOUS', 'HISTORICAL', 'COSMIC', 'SCIENTIFIC',
  'DARK_LUXURY', 'ANCIENT_MANUSCRIPT', 'SURREAL_SYMBOLIC', 'HIGH_CONTRAST_EDITORIAL',
  'MODERN_DOCUMENTARY', 'EPIC_HISTORICAL',
];

const ANALYZER_SYSTEM = `Du bist SCRIPT ANALYZER, ein hochspezialisierter Analyst für YouTube-Skripte.
Du liest das KOMPLETTE Skript und extrahierst die inhaltlich und visuell relevantesten Elemente.

Harte Regeln:
- Erfinde keine Fakten. Was nicht im Skript steht, ist keine Tatsachenaussage.
- Trenne strikt zwischen FACTUAL_STATEMENTS (wörtlich im Skript belegt) und CREATIVE_INTERPRETATIONS (freie visuelle Deutung).
- Antworte ausschließlich mit gültigem JSON nach dem vorgegebenen Schema.
- Antworte inhaltlich in der Sprache des Skripts (in der Regel Deutsch).
- Vermeide Marketing-Floskeln, formuliere präzise und sachlich.`;

function normalizeStyle(value: unknown, fallback: StylePreset = 'CINEMATIC_DOCUMENTARY'): StylePreset {
  const v = String(value ?? '').toUpperCase().replace(/[\s-]/g, '_');
  return (VALID_STYLES.find((s) => s === v) ?? fallback) as StylePreset;
}

function arr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function s(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function normalizeAnalysis(raw: Record<string, unknown>, script: ParsedScript, language: string): ScriptAnalysis {
  return {
    VIDEO_TITLE: s(raw.VIDEO_TITLE, script.titleGuess),
    VIDEO_TOPIC: s(raw.VIDEO_TOPIC, script.titleGuess),
    CORE_THESIS: s(raw.CORE_THESIS),
    PRIMARY_HOOK: s(raw.PRIMARY_HOOK),
    SECONDARY_HOOK: s(raw.SECONDARY_HOOK),
    EMOTIONAL_CORE: s(raw.EMOTIONAL_CORE),
    KEY_CONFLICT: s(raw.KEY_CONFLICT),
    KEY_QUESTION: s(raw.KEY_QUESTION),
    KEY_MYSTERY: s(raw.KEY_MYSTERY),
    IMPORTANT_PEOPLE: arr(raw.IMPORTANT_PEOPLE),
    IMPORTANT_OBJECTS: arr(raw.IMPORTANT_OBJECTS),
    IMPORTANT_LOCATIONS: arr(raw.IMPORTANT_LOCATIONS),
    IMPORTANT_SYMBOLS: arr(raw.IMPORTANT_SYMBOLS),
    HISTORICAL_ELEMENTS: arr(raw.HISTORICAL_ELEMENTS),
    SCIENTIFIC_ELEMENTS: arr(raw.SCIENTIFIC_ELEMENTS),
    SPIRITUAL_ELEMENTS: arr(raw.SPIRITUAL_ELEMENTS),
    VISUAL_METAPHORS: arr(raw.VISUAL_METAPHORS),
    POSSIBLE_THUMBNAIL_SCENARIOS: arr(raw.POSSIBLE_THUMBNAIL_SCENARIOS),
    THUMBNAIL_TEXT_CANDIDATES: arr(raw.THUMBNAIL_TEXT_CANDIDATES),
    WHY_THIS_THUMBNAIL_COULD_WORK: s(raw.WHY_THIS_THUMBNAIL_COULD_WORK),
    FACTUAL_STATEMENTS: arr(raw.FACTUAL_STATEMENTS),
    CREATIVE_INTERPRETATIONS: arr(raw.CREATIVE_INTERPRETATIONS),
    SUGGESTED_STYLE: normalizeStyle(raw.SUGGESTED_STYLE),
    LANGUAGE: s(raw.LANGUAGE, language),
  };
}

/** Merge per-chunk analyses of a very long script into one coherent result. */
function mergeAnalyses(parts: ScriptAnalysis[]): ScriptAnalysis {
  const base = { ...parts[0] };
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const listKeys: (keyof ScriptAnalysis)[] = [
    'IMPORTANT_PEOPLE', 'IMPORTANT_OBJECTS', 'IMPORTANT_LOCATIONS', 'IMPORTANT_SYMBOLS',
    'HISTORICAL_ELEMENTS', 'SCIENTIFIC_ELEMENTS', 'SPIRITUAL_ELEMENTS', 'VISUAL_METAPHORS',
    'POSSIBLE_THUMBNAIL_SCENARIOS', 'THUMBNAIL_TEXT_CANDIDATES', 'FACTUAL_STATEMENTS',
    'CREATIVE_INTERPRETATIONS',
  ];
  for (const key of listKeys) {
    (base as Record<string, unknown>)[key] = uniq(parts.flatMap((p) => p[key] as string[])).slice(0, 12);
  }
  for (const key of ['CORE_THESIS', 'PRIMARY_HOOK', 'KEY_MYSTERY', 'KEY_CONFLICT'] as const) {
    const longest = parts.map((p) => p[key]).sort((a, b) => b.length - a.length)[0];
    if (longest) base[key] = longest;
  }
  return base;
}

export interface AnalyzeOptions {
  provider: TextProvider;
  script: ParsedScript;
  language: string;
  jobId: string;
  /** Title given by the user/channel, if known. */
  knownTitle?: string;
  onModel?: (model: string) => void;
}

/**
 * Deep analysis of the WHOLE script (section 4).
 * Uses a single long-context call when possible, chunked map/merge otherwise.
 */
export async function analyzeScript(opts: AnalyzeOptions): Promise<ScriptAnalysis> {
  const { provider, script, language, jobId } = opts;
  const chunks = chunkScript(script.text);
  const results: ScriptAnalysis[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? `\n\n[HINWEIS: Dies ist Teil ${i + 1} von ${chunks.length} eines langen Skripts.]` : '';
    const user = `Analysiere das folgende YouTube-Skript vollständig.

Dateiname: ${script.sourceFile}
Vermuteter Titel: ${opts.knownTitle ?? script.titleGuess}
Sprache: ${language}
Wortanzahl gesamt: ${script.wordCount}${part}

=== SKRIPT START ===
${chunks[i]}
=== SKRIPT ENDE ===

Gib ein JSON-Objekt mit exakt diesen Feldern zurück:
VIDEO_TITLE, VIDEO_TOPIC, CORE_THESIS, PRIMARY_HOOK, SECONDARY_HOOK, EMOTIONAL_CORE, KEY_CONFLICT,
KEY_QUESTION, KEY_MYSTERY, IMPORTANT_PEOPLE, IMPORTANT_OBJECTS, IMPORTANT_LOCATIONS, IMPORTANT_SYMBOLS,
HISTORICAL_ELEMENTS, SCIENTIFIC_ELEMENTS, SPIRITUAL_ELEMENTS, VISUAL_METAPHORS,
POSSIBLE_THUMBNAIL_SCENARIOS, THUMBNAIL_TEXT_CANDIDATES, WHY_THIS_THUMBNAIL_COULD_WORK,
FACTUAL_STATEMENTS, CREATIVE_INTERPRETATIONS, SUGGESTED_STYLE, LANGUAGE.

SUGGESTED_STYLE muss einer dieser Werte sein: ${VALID_STYLES.join(', ')}.`;

    const { value, model } = await provider.completeJson<Record<string, unknown>>({
      system: ANALYZER_SYSTEM,
      user,
      jsonSchemaName: 'script_analysis',
      schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: 5000,
      jobId,
    });
    opts.onModel?.(model);
    results.push(normalizeAnalysis(value, script, language));
    logger.debug(`Skriptanalyse Teil ${i + 1}/${chunks.length} abgeschlossen`, { job_id: jobId, stage: 'analysis', model });
  }

  return results.length === 1 ? results[0] : mergeAnalyses(results);
}
