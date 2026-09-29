/** JSON schemas for structured model output. Kept in one place for reuse. */

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: { type: 'string' } } as const;

export const SCORE_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    [
      'ATTENTION', 'CURIOSITY', 'INSTANT_COMPREHENSION', 'EMOTIONAL_IMPACT', 'VISUAL_CLARITY',
      'SUBJECT_PROMINENCE', 'COMPOSITION', 'CONTRAST', 'COLOR_DIVERSITY', 'SMALL_SCREEN_READABILITY',
      'TITLE_ALIGNMENT', 'NOVELTY', 'CLICK_INTENT', 'CONTENT_ACCURACY', 'VISUAL_SIMPLICITY',
    ].map((k) => [k, { type: 'number', minimum: 0, maximum: 10 }]),
  ),
  required: [
    'ATTENTION', 'CURIOSITY', 'INSTANT_COMPREHENSION', 'EMOTIONAL_IMPACT', 'VISUAL_CLARITY',
    'SUBJECT_PROMINENCE', 'COMPOSITION', 'CONTRAST', 'COLOR_DIVERSITY', 'SMALL_SCREEN_READABILITY',
    'TITLE_ALIGNMENT', 'NOVELTY', 'CLICK_INTENT', 'CONTENT_ACCURACY', 'VISUAL_SIMPLICITY',
  ],
} as const;

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    VIDEO_TITLE: str, VIDEO_TOPIC: str, CORE_THESIS: str, PRIMARY_HOOK: str, SECONDARY_HOOK: str,
    EMOTIONAL_CORE: str, KEY_CONFLICT: str, KEY_QUESTION: str, KEY_MYSTERY: str,
    IMPORTANT_PEOPLE: strArr, IMPORTANT_OBJECTS: strArr, IMPORTANT_LOCATIONS: strArr,
    IMPORTANT_SYMBOLS: strArr, HISTORICAL_ELEMENTS: strArr, SCIENTIFIC_ELEMENTS: strArr,
    SPIRITUAL_ELEMENTS: strArr, VISUAL_METAPHORS: strArr, POSSIBLE_THUMBNAIL_SCENARIOS: strArr,
    THUMBNAIL_TEXT_CANDIDATES: strArr, WHY_THIS_THUMBNAIL_COULD_WORK: str,
    FACTUAL_STATEMENTS: strArr, CREATIVE_INTERPRETATIONS: strArr,
    SUGGESTED_STYLE: str, LANGUAGE: str,
  },
  required: ['VIDEO_TITLE', 'VIDEO_TOPIC', 'CORE_THESIS', 'PRIMARY_HOOK', 'EMOTIONAL_CORE'],
} as const;

export const CONCEPTS_SCHEMA = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: str, label: str, idea: str, subject: str, action: str, environment: str, era: str,
          composition: str, camera: str, lighting: str, color: str, mood: str, depth: str,
          detail: str, visualMetaphor: str, textArea: str, style: str, thumbnailText: str,
          unusual: { type: 'boolean' }, rationale: str, score: SCORE_SCHEMA,
        },
        required: ['id', 'label', 'idea', 'subject', 'composition', 'textArea', 'thumbnailText'],
      },
    },
  },
  required: ['concepts'],
} as const;

export const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    firstImpression: str, mainSubject: str,
    topicClear: { type: 'boolean' }, createsCuriosity: { type: 'boolean' },
    hierarchyClear: { type: 'boolean' }, textAreaSufficient: { type: 'boolean' },
    textAreaLocation: str, overloaded: { type: 'boolean' },
    looksPremium: { type: 'boolean' }, looksLikeRealThumbnail: { type: 'boolean' },
    visualContradictions: strArr, anatomyOrPerspectiveErrors: strArr, artifacts: strArr,
    titleImageConnection: str, score: SCORE_SCHEMA, improvementPrompt: str, summary: str,
  },
  required: ['firstImpression', 'mainSubject', 'score', 'summary'],
} as const;

export const TEXT_SCHEMA = {
  type: 'object',
  properties: { text: str, reason: str },
  required: ['text'],
} as const;

export const SELECTION_SCHEMA = {
  type: 'object',
  properties: { selectedIndex: { type: 'number' }, reason: str },
  required: ['selectedIndex', 'reason'],
} as const;

export const REFERENCE_STYLE_SCHEMA = {
  type: 'object',
  properties: {
    composition: str, lighting: str, visual_density: str, color_mood: str,
    imagery: str, text_placement: str, style_summary: str,
  },
  required: ['style_summary'],
} as const;

export const MOBILE_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    textReadable: { type: 'boolean' },
    subjectRecognizable: { type: 'boolean' },
    compositionClear: { type: 'boolean' },
    notes: str,
  },
  required: ['textReadable', 'subjectRecognizable', 'compositionClear'],
} as const;
