import { describe, expect, it } from 'vitest';
import { computeScoreTotal, normalizeScore, selectTopConcepts } from '../src/ai/thumbnail/strategist.js';
import { buildImagePrompt } from '../src/ai/prompting/promptBuilder.js';
import { DEFAULT_CHANNEL_PROFILE } from '../src/config/index.js';
import type { ScriptAnalysis, ThumbnailConcept } from '../src/types/index.js';

function concept(
  id: string,
  score: number,
  unusual = false,
  textArea: ThumbnailConcept['textArea'] = 'RIGHT_TEXT',
  strategy: ThumbnailConcept['strategy'] = 'SUBJECT_CLOSEUP',
): ThumbnailConcept {
  const s = normalizeScore(Object.fromEntries(Object.keys(normalizeScore({})).map((k) => [k, score])));
  return {
    id, label: `Konzept ${id}`, strategy, emotion: 'Staunen', idea: 'Idee', subject: 'Motiv', action: '', environment: '', era: '',
    composition: 'Motiv links', camera: '', lighting: '', color: '', mood: '', depth: '', detail: '',
    visualMetaphor: '', textArea, style: 'CINEMATIC_DOCUMENTARY', thumbnailText: 'TEXT',
    unusual, score: s, scoreTotal: computeScoreTotal(s),
  };
}

const analysis: ScriptAnalysis = {
  VIDEO_TITLE: 'Alchemie – Das verbotene Wissen', VIDEO_TOPIC: 'Alchemie', CORE_THESIS: 'These',
  PRIMARY_HOOK: 'Hook', SECONDARY_HOOK: '', EMOTIONAL_CORE: 'Staunen', KEY_CONFLICT: '', KEY_QUESTION: '',
  KEY_MYSTERY: '', IMPORTANT_PEOPLE: [], IMPORTANT_OBJECTS: [], IMPORTANT_LOCATIONS: ['Labor'],
  IMPORTANT_SYMBOLS: [], HISTORICAL_ELEMENTS: [], SCIENTIFIC_ELEMENTS: [], SPIRITUAL_ELEMENTS: [],
  VISUAL_METAPHORS: [], POSSIBLE_THUMBNAIL_SCENARIOS: [], THUMBNAIL_TEXT_CANDIDATES: ['X'],
  WHY_THIS_THUMBNAIL_COULD_WORK: '', FACTUAL_STATEMENTS: [], CREATIVE_INTERPRETATIONS: [],
  SUGGESTED_STYLE: 'CINEMATIC_DOCUMENTARY', LANGUAGE: 'de',
};

describe('Design-Score', () => {
  it('normalisiert fehlende Werte auf 5 und begrenzt auf 0..10', () => {
    const s = normalizeScore({ ATTENTION: 99, CURIOSITY: -4 });
    expect(s.ATTENTION).toBe(10);
    expect(s.CURIOSITY).toBe(0);
    expect(s.COMPOSITION).toBe(5);
  });

  it('berechnet einen gewichteten Gesamtscore', () => {
    const all8 = normalizeScore(Object.fromEntries(Object.keys(normalizeScore({})).map((k) => [k, 8])));
    expect(computeScoreTotal(all8)).toBeCloseTo(8, 5);
  });
});

describe('Konzeptauswahl', () => {
  it('wählt die stärksten Konzepte und erzwingt Vielfalt', () => {
    const concepts = [
      concept('A', 9, false, 'RIGHT_TEXT'),
      concept('B', 8, false, 'RIGHT_TEXT'),
      concept('C', 7, true, 'LEFT_TEXT'),
      concept('D', 6, false, 'BOTTOM_TEXT'),
      concept('E', 5, false, 'TOP_TEXT'),
    ];
    const top = selectTopConcepts(concepts, 4);
    expect(top).toHaveLength(4);
    expect(top.some((c) => c.unusual)).toBe(true);
    expect(new Set(top.map((c) => c.id)).size).toBe(4);
  });
});

describe('Prompt-Builder', () => {
  const prompt = buildImagePrompt({
    concept: concept('A', 8), analysis, profile: DEFAULT_CHANNEL_PROFILE, textMode: 'LOCAL_OVERLAY',
  });

  it('enthält alle Prompt-Ebenen', () => {
    for (const layer of ['SCENE', 'COMPOSITION AND CAMERA', 'EMOTION', 'LIGHTING', 'COLOR', 'STYLE', 'THUMBNAIL FUNCTION', 'RESERVED SPACE', 'AVOID', 'ACCURACY']) {
      expect(prompt).toContain(layer);
    }
  });

  it('verbietet Text im LOCAL_OVERLAY-Modus', () => {
    expect(prompt).toContain('no text, letters, numbers, captions, watermarks or logos');
  });

  it('fordert Text im AI_RENDERED-Modus an', () => {
    const aiPrompt = buildImagePrompt({
      concept: concept('A', 8), analysis, profile: DEFAULT_CHANNEL_PROFILE,
      textMode: 'AI_RENDERED', thumbnailText: 'Das verbotene Wissen',
    });
    expect(aiPrompt).toContain('DAS VERBOTENE WISSEN');
    expect(aiPrompt).not.toContain('no text, letters, numbers, captions, watermarks or logos');
  });

  it('reserviert eine Textfläche passend zum Konzept', () => {
    expect(prompt).toContain('visually calm');
    expect(prompt).toMatch(/right/i);
  });
});
