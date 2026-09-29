import type { ChannelProfile, ScriptAnalysis, TextMode, TextPosition, ThumbnailConcept } from '../../types/index.js';

/** Where the image must stay calm so the overlay text can breathe (section 21). */
export const TEXT_AREA_DESCRIPTION: Record<TextPosition, string> = {
  LEFT_TEXT: 'the left third of the frame stays visually calm and uncluttered (dark or low-detail), no important detail there',
  RIGHT_TEXT: 'the right third of the frame stays visually calm and uncluttered (dark or low-detail), no important detail there',
  TOP_TEXT: 'the upper 30% of the frame stays visually calm and uncluttered, no important detail there',
  BOTTOM_TEXT: 'the lower 30% of the frame stays visually calm and uncluttered, no important detail there',
  CENTER_TEXT: 'the central horizontal band stays relatively calm, the subject is pushed to the outer thirds',
};

const STYLE_HINTS: Record<string, string> = {
  CINEMATIC_DOCUMENTARY: 'cinematic documentary photography, anamorphic feel, motivated practical light, filmic contrast',
  PHOTOREALISTIC: 'photorealistic, physically correct light, real camera optics, natural micro-texture',
  MYSTERIOUS: 'low-key mystery lighting, deep shadows, one dominant light source, restrained fog only where motivated',
  HISTORICAL: 'historically plausible materials, patina, period-correct props, museum-grade authenticity',
  COSMIC: 'astronomical scale, deep space contrast, physically plausible cosmic light',
  SCIENTIFIC: 'clean laboratory realism, precise instruments, controlled cool lighting',
  DARK_LUXURY: 'dark premium editorial look, rich materials, controlled specular highlights',
  ANCIENT_MANUSCRIPT: 'aged parchment, ink texture, candlelit archive, tactile paper fibres',
  SURREAL_SYMBOLIC: 'surreal but coherent symbolism, one impossible element inside an otherwise real scene',
  HIGH_CONTRAST_EDITORIAL: 'bold editorial contrast, graphic shapes, strong figure-ground separation',
  MODERN_DOCUMENTARY: 'modern documentary realism, handheld feel, natural colour grading',
  EPIC_HISTORICAL: 'epic historical scale, monumental architecture, dramatic sky and light',
};

const UNIVERSAL_NEGATIVES = [
  'no text, no letters, no words, no captions, no watermarks, no logos, no numbers',
  'no collage, no split grid of many panels, no borders or frames',
  'no generic stock photography aesthetic',
  'no plastic, waxy or overly glossy AI skin',
  'no random lens flares, no floating particles, no unmotivated fog',
  'no everything-is-gold colour scheme',
  'no exaggerated vignette',
  'no cheap sci-fi look',
  'no cluttered background full of tiny objects',
  'no boring perfect symmetry',
  'no extra limbs, no deformed hands, no broken anatomy, no impossible perspective',
  'no tiny main subject, no low contrast mush',
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

/** Layered prompt builder (section 20). */
export function buildImagePrompt(input: PromptBuildInput): string {
  const { concept, analysis, profile, textMode } = input;
  const style = STYLE_HINTS[concept.style] ?? STYLE_HINTS.CINEMATIC_DOCUMENTARY;
  const aspect = input.aspectRatio ?? profile.preferred_aspect_ratio ?? '16:9';
  const aiText = textMode === 'AI_RENDERED' || textMode === 'BOTH_FOR_COMPARISON';

  const negatives = [...UNIVERSAL_NEGATIVES, ...profile.forbidden_elements.map((f) => `avoid: ${f}`)];
  const textNegatives = aiText ? negatives.filter((n) => !n.startsWith('no text')) : negatives;

  const lines = [
    `Create a premium, professional ${aspect} YouTube thumbnail image — not a generic illustration, not a movie poster.`,
    '',
    'Subject:',
    `${concept.subject}. ${concept.action}`.trim(),
    '',
    'Action:',
    concept.action || 'a single decisive moment, frozen',
    '',
    'Environment:',
    concept.environment || analysis.IMPORTANT_LOCATIONS[0] || 'an atmospheric environment that matches the topic',
    '',
    'Era / context:',
    concept.era || 'timeless, plausible for the topic',
    '',
    'Composition:',
    `${concept.composition}. One single dominant focal point that fills a large part of the frame. Strong silhouette, clear foreground / midground / background separation, decisive visual hierarchy, rule-of-thirds placement, no clutter.`,
    '',
    'Camera:',
    concept.camera || '35mm full-frame, slightly low angle, shallow depth of field',
    '',
    'Lighting:',
    `${concept.lighting || 'directed key light with deep falloff'}; high-quality motivated lighting, strong separation between subject and background`,
    '',
    'Color:',
    `${concept.color || profile.preferred_color_moods[0]}; high contrast, limited but distinct palette, no muddy midtones`,
    '',
    'Mood:',
    concept.mood || analysis.EMOTIONAL_CORE || 'intriguing and premium',
    '',
    'Depth:',
    concept.depth || 'pronounced depth, subject clearly detached from background',
    '',
    'Important details:',
    `${concept.detail || 'few but precise details on the main subject'}. Visual metaphor: ${concept.visualMetaphor || 'the hidden becomes visible'}.`,
    '',
    'Text-safe area:',
    `Reserve clean negative space for a headline: ${TEXT_AREA_DESCRIPTION[concept.textArea]}.`,
    '',
    'Thumbnail use:',
    `Must read instantly at 320px width on a phone: large subject, bold shapes, strong contrast, ${profile.preferred_thumbnail_density} visual density, subject size ${profile.preferred_subject_size}.`,
    '',
    'Style:',
    style,
    '',
    'Accuracy:',
    'Artistic reconstruction is allowed and should look like one; do not fabricate a documentary "proof" of something that did not happen, and do not depict identifiable real people doing things the script does not state.',
  ];

  if (aiText) {
    lines.push('', 'Rendered headline:', `Render the exact headline "${(input.thumbnailText ?? concept.thumbnailText).toUpperCase()}" once, in a bold condensed sans-serif, cleanly placed in the reserved text area, perfectly spelled, no other text anywhere.`);
  }

  if (input.referenceStyle) {
    lines.push('', 'Abstract style direction (do NOT copy any existing artwork):', input.referenceStyle);
  }

  if (input.improvement) {
    lines.push('', 'Targeted improvements over the previous attempt:', input.improvement);
  }

  lines.push('', 'Avoid:', textNegatives.map((n) => `- ${n}`).join('\n'));
  lines.push('', 'Do not produce:', '- a poster, a book cover, a magazine layout, a UI mockup, an infographic, or any typography (unless a headline was explicitly requested above)');

  return lines.join('\n');
}

/** Human-readable dump written to PROMPT_USED.txt. */
export function formatPromptFile(params: {
  prompt: string;
  concept: ThumbnailConcept;
  model: string;
  quality: string;
  size: string;
  textMode: TextMode;
  thumbnailText: string;
}): string {
  return `# PROMPT USED
Model:      ${params.model}
Quality:    ${params.quality}
Size:       ${params.size}
Text mode:  ${params.textMode}
Text:       ${params.thumbnailText}
Concept:    ${params.concept.id} – ${params.concept.label}
Text area:  ${params.concept.textArea}

--- IMAGE PROMPT ---
${params.prompt}
`;
}
