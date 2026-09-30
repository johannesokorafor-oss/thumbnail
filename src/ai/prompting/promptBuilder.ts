import type {
  ChannelProfile,
  ScriptAnalysis,
  TextMode,
  TextPosition,
  ThumbnailConcept,
  ThumbnailStrategy,
} from '../../types/index.js';

/** Where the image must stay calm so the overlay text can breathe. */
export const TEXT_AREA_DESCRIPTION: Record<TextPosition, string> = {
  LEFT_TEXT: 'the left third of the frame',
  RIGHT_TEXT: 'the right third of the frame',
  TOP_TEXT: 'the upper third of the frame',
  BOTTOM_TEXT: 'the lower third of the frame',
  CENTER_TEXT: 'a horizontal band across the middle of the frame',
};

const SUBJECT_PLACEMENT: Record<TextPosition, string> = {
  LEFT_TEXT: 'Place the main subject in the right half of the frame, facing or leaning into the empty left side.',
  RIGHT_TEXT: 'Place the main subject in the left half of the frame, facing or leaning into the empty right side.',
  TOP_TEXT: 'Place the main subject low and large in the frame so the sky/ceiling area above stays open.',
  BOTTOM_TEXT: 'Place the main subject high in the frame so the foreground area below stays open and simple.',
  CENTER_TEXT: 'Split the interest to the left and right thirds and keep the central band comparatively quiet.',
};

/**
 * Camera and framing recipes per visual strategy.
 * Each strategy produces a genuinely different picture, not a re-worded variant.
 */
const STRATEGY_DIRECTION: Record<ThumbnailStrategy, { framing: string; intent: string }> = {
  SUBJECT_CLOSEUP: {
    framing:
      'Tight portrait framing: head-and-shoulders or closer, subject filling roughly half the frame height, 85mm lens look, shallow depth of field with the background falling into soft, dark separation.',
    intent: 'The face (or the single hero surface) carries the entire story. One person, one expression, nothing competing.',
  },
  DRAMATIC_SCENE: {
    framing:
      'Wider cinematic framing with a clear hero silhouette against the environment, 35mm lens look, strong perspective lines leading to the subject, layered foreground / midground / background.',
    intent: 'A decisive moment caught mid-action, the kind of frame that implies what happened one second earlier.',
  },
  MYSTERY_REVEAL: {
    framing:
      'Partially concealed subject: shot through a doorway, shadow, fabric, dust or glass so a meaningful part stays hidden, with a single bright accent drawing the eye to what is revealed.',
    intent: 'The viewer must feel they are seeing the edge of something and want the rest.',
  },
  HUMAN_EMOTION: {
    framing:
      'Human reaction framing: upper body, hands and face both readable, eye level or slightly low angle, the emotional gesture forming a strong silhouette.',
    intent: 'A single unmistakable emotion — realisation, shock, grief, awe — never a neutral posed look.',
  },
  SYMBOLIC_METAPHOR: {
    framing:
      'Graphic, almost editorial composition built around one symbolic object or event, generous negative space, deliberate geometry, one impossible or surreal element inside an otherwise physically real scene.',
    intent: 'The image reads as an idea, not as a snapshot.',
  },
  OBJECT_HERO: {
    framing:
      'The object is the protagonist: macro or near-macro, dramatic scale, lit like a museum piece, background reduced to tone and shadow.',
    intent: 'A thing nobody would normally look twice at is made monumental.',
  },
  CONTRAST_SPLIT: {
    framing:
      'A single continuous frame that contains two contrasting realities (then/now, outside/inside, micro/macro) separated by a natural edge in the scene — light, architecture, water, a horizon — not by a hard graphic divider.',
    intent: 'The tension between the two halves is the hook.',
  },
  SCALE_SHIFT: {
    framing:
      'Extreme scale relationship: a small human figure against something overwhelming, or a microscopic detail treated like a landscape, with strong atmospheric depth.',
    intent: 'The size relationship itself is the story.',
  },
};

/**
 * How much of the frame the subject must occupy, per strategy.
 * "Subject too small" is one of the most common reasons a technically good
 * image fails as a thumbnail, so the scale is stated as a number instead of
 * being left to the model's taste.
 */
const SUBJECT_SCALE: Record<ThumbnailStrategy, string> = {
  SUBJECT_CLOSEUP: 'The subject fills about 60-75% of the frame height.',
  DRAMATIC_SCENE: 'The hero subject fills about 35-50% of the frame height and is unmistakably the largest element.',
  MYSTERY_REVEAL: 'The revealed part fills about 30-45% of the frame height and is the brightest area.',
  HUMAN_EMOTION: 'The face and hands together fill about 45-60% of the frame height.',
  SYMBOLIC_METAPHOR: 'The symbolic element fills about 40-55% of the frame height against generous empty space.',
  OBJECT_HERO: 'The object fills about 55-70% of the frame height.',
  CONTRAST_SPLIT: 'Each of the two realities fills roughly half the frame; the key detail in each is large enough to read at 320 pixels.',
  SCALE_SHIFT: 'The overwhelming element dominates the frame; the small reference figure stays at least 8% of the frame height so it remains visible when scaled down.',
};

/** Words that state a left/right/top/bottom placement. */
const PLACEMENT_WORDS = /\b(links|rechts|oben|unten|mittig|zentriert|left|right|top|bottom|centre|center)\b/i;

const STYLE_HINTS: Record<string, string> = {
  CINEMATIC_DOCUMENTARY: 'Cinematic documentary photography. Motivated practical light, filmic contrast, real optics, subtle grain.',
  PHOTOREALISTIC: 'Photorealistic photography. Physically correct light, real lens behaviour, natural micro-texture in skin and material.',
  MYSTERIOUS: 'Low-key mystery photography. Deep shadow, one dominant light source, atmosphere only where the scene motivates it.',
  HISTORICAL: 'Historically plausible photography. Period-correct materials, patina, museum-grade authenticity, no fantasy props.',
  COSMIC: 'Astrophotography-inspired realism. Vast scale, deep blacks, physically plausible cosmic light.',
  SCIENTIFIC: 'Clean scientific realism. Precise instruments, controlled cool lighting, laboratory-accurate detail.',
  DARK_LUXURY: 'Dark premium editorial photography. Rich materials, controlled specular highlights, restrained palette.',
  ANCIENT_MANUSCRIPT: 'Archive photography. Aged parchment, ink texture, candlelit reading room, tactile paper fibres.',
  SURREAL_SYMBOLIC: 'Surreal editorial photography. One impossible element rendered with complete physical realism.',
  HIGH_CONTRAST_EDITORIAL: 'Bold editorial photography. Graphic shapes, hard figure-ground separation, confident negative space.',
  MODERN_DOCUMENTARY: 'Modern documentary realism. Handheld energy, natural colour grading, unstaged feeling.',
  EPIC_HISTORICAL: 'Epic historical cinematography. Monumental scale, dramatic sky, strong god-rays only where motivated.',
};

/**
 * A short, non-contradictory negative list.
 * The OpenAI image guidance warns against over-constraining with long,
 * conflicting instruction lists, so this stays focused on the failure modes
 * that actually ruin a thumbnail.
 */
const CORE_NEGATIVES = [
  'no text, letters, numbers, captions, watermarks or logos anywhere in the image',
  'no duplicated or cloned subjects, no malformed hands or faces, no impossible anatomy',
  'no busy background full of small competing objects',
  'no second focal point that fights the main subject',
  'no borders, frames, collage panels or split-screen graphics',
  'no flat, evenly lit stock-photo look',
];

export interface PromptBuildInput {
  concept: ThumbnailConcept;
  analysis: ScriptAnalysis;
  profile: ChannelProfile;
  textMode: TextMode;
  thumbnailText?: string;
  aspectRatio?: string;
  referenceStyle?: string;
  improvement?: string;
}

function sentence(value: string | undefined, fallback = ''): string {
  const v = (value ?? '').trim();
  if (!v) return fallback;
  return /[.!?]$/.test(v) ? v : `${v}.`;
}

/**
 * Builds a professional image specification that optimises for a THUMBNAIL,
 * not for a generically pretty picture.
 */
export function buildImagePrompt(input: PromptBuildInput): string {
  const { concept, analysis, profile, textMode } = input;
  const strategy = concept.strategy ?? 'DRAMATIC_SCENE';
  const direction = STRATEGY_DIRECTION[strategy] ?? STRATEGY_DIRECTION.DRAMATIC_SCENE;
  const style = STYLE_HINTS[concept.style] ?? STYLE_HINTS.CINEMATIC_DOCUMENTARY;
  const aspect = input.aspectRatio ?? profile.preferred_aspect_ratio ?? '16:9';
  const aiText = textMode === 'AI_RENDERED' || textMode === 'BOTH_FOR_COMPARISON';

  const negatives = aiText ? CORE_NEGATIVES.slice(1) : CORE_NEGATIVES;
  const forbidden = profile.forbidden_elements.slice(0, 4);

  const parts: string[] = [];

  parts.push(
    `A single ${aspect} photographic still designed to work as a YouTube video thumbnail. ` +
      `${direction.intent}`,
  );

  parts.push(
    [
      'SCENE',
      sentence(concept.subject, 'A single strong subject.'),
      sentence(concept.action),
      sentence(concept.environment, sentence(analysis.IMPORTANT_LOCATIONS[0])),
      sentence(concept.era),
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // The reserved text area dictates where the subject sits. A concept sentence
  // that states a DIFFERENT side would contradict it, so it is dropped rather
  // than stacked on top — conflicting instructions produce muddled images.
  const conceptComposition = sentence(concept.composition);
  const compositionConflicts = PLACEMENT_WORDS.test(concept.composition ?? '');
  parts.push(
    [
      'COMPOSITION AND CAMERA',
      direction.framing,
      SUBJECT_PLACEMENT[concept.textArea],
      SUBJECT_SCALE[strategy],
      compositionConflicts ? '' : conceptComposition,
      sentence(concept.camera),
      'One unmistakable focal point. Strong readable silhouette. Clear separation between foreground, subject and background. Deliberate depth.',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  if (concept.emotion || strategy === 'HUMAN_EMOTION' || strategy === 'SUBJECT_CLOSEUP') {
    parts.push(
      ['EMOTION', sentence(concept.emotion, 'A specific, readable human emotion carried by expression and body language — intense but not theatrical.')].join('\n'),
    );
  }

  parts.push(
    [
      'LIGHTING',
      sentence(concept.lighting, 'Directional key light with deep, controlled falloff.'),
      'Light must separate the subject from the background: rim light, backlight or a bright surface behind a dark subject.',
    ].join('\n'),
  );

  parts.push(
    [
      'COLOR',
      sentence(concept.color, sentence(profile.preferred_color_moods[0])),
      'Limited, coherent palette with one dominant accent. Deep blacks, clean highlights, no muddy midtones.',
    ].join('\n'),
  );

  parts.push(['STYLE', style, sentence(concept.mood, sentence(analysis.EMOTIONAL_CORE))].filter(Boolean).join('\n'));

  parts.push(
    [
      'THUMBNAIL FUNCTION',
      `The image will be viewed at 320 pixels wide. Everything essential must survive that reduction: ${profile.preferred_subject_size} subject, bold shapes, high contrast, ${profile.preferred_thumbnail_density} visual density.`,
      'No fine detail that carries meaning. No small objects that turn to noise when scaled down.',
    ].join('\n'),
  );

  parts.push(
    [
      'RESERVED SPACE',
      aiText
        ? `Keep ${TEXT_AREA_DESCRIPTION[concept.textArea]} visually calm for a headline.`
        : `Keep ${TEXT_AREA_DESCRIPTION[concept.textArea]} visually calm and low in detail — a headline will be composited there afterwards. Nothing important may sit in that area.`,
    ].join('\n'),
  );

  if (input.referenceStyle) {
    parts.push(['STYLE REFERENCE (abstract direction only, never copy an existing artwork)', input.referenceStyle].join('\n'));
  }

  if (input.improvement) {
    parts.push(['TARGETED CHANGES COMPARED TO THE PREVIOUS ATTEMPT', input.improvement].join('\n'));
  }

  if (aiText) {
    parts.push(
      [
        'HEADLINE',
        `Render exactly this headline once, spelled exactly as written: "${(input.thumbnailText ?? concept.thumbnailText).toUpperCase()}".`,
        `Bold condensed sans-serif, placed in ${TEXT_AREA_DESCRIPTION[concept.textArea]}, high contrast against its background. No other text anywhere.`,
      ].join('\n'),
    );
  }

  // Kept deliberately short: long negative lists over-constrain the model and
  // start to contradict each other.
  const avoidList = [...negatives, ...forbidden]
    .map((n) => n.trim())
    .filter((n, i, all) => n && all.indexOf(n) === i)
    .slice(0, 7);
  parts.push(['AVOID', ...avoidList.map((n) => `- ${n}`)].join('\n'));

  parts.push(
    'ACCURACY\nTreat undocumented historical moments as clearly artistic reconstructions. Do not depict identifiable real people performing actions the source material does not state.',
  );

  return parts.join('\n\n');
}

/** Short, specific instruction for a targeted refinement edit. */
export function buildRefinementPrompt(params: {
  concept: ThumbnailConcept;
  defects: string[];
  instruction: string;
  textArea: TextPosition;
}): string {
  const fixes = params.defects.slice(0, 3).map((d) => `- ${d}`).join('\n');
  return [
    'Refine this thumbnail image. Keep the overall composition, subject identity, lighting mood and colour palette intact.',
    '',
    'Fix only the following:',
    fixes || `- ${params.instruction}`,
    '',
    params.instruction,
    '',
    `Keep ${TEXT_AREA_DESCRIPTION[params.textArea]} calm and free of important detail.`,
    'Do not add text, letters, logos or watermarks. Do not change the subject into a different person or object.',
  ].join('\n');
}

/** Human-readable dump written to PROMPT_USED.txt. */
export function formatPromptFile(params: {
  prompt: string;
  concept: ThumbnailConcept;
  model: string;
  quality: string;
  size: string;
  requested?: { model: string; quality: string; size: string };
  textMode: TextMode;
  thumbnailText: string;
  degradations?: Array<{ kind: string; requested: string; actual: string; reason: string }>;
}): string {
  const deg = params.degradations?.length
    ? params.degradations.map((d) => `  - ${d.kind}: ${d.requested} -> ${d.actual} (${d.reason})`).join('\n')
    : '  keine';
  return `# PROMPT USED

Angefragt:  model=${params.requested?.model ?? params.model} quality=${params.requested?.quality ?? params.quality} size=${params.requested?.size ?? params.size}
Tatsächlich: model=${params.model} quality=${params.quality} size=${params.size}
Abweichungen:
${deg}

Text mode:  ${params.textMode}
Text:       ${params.thumbnailText}
Konzept:    ${params.concept.id} – ${params.concept.label} [${params.concept.strategy ?? 'n/a'}]
Textfläche: ${params.concept.textArea}

--- IMAGE PROMPT ---
${params.prompt}
`;
}
