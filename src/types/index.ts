/**
 * Central domain types for the Thumbnail Studio pipeline.
 * Kept free of any provider-specific details on purpose.
 */

export type JobStatus =
  | 'DETECTED'
  | 'QUEUED'
  | 'ANALYZING'
  | 'DESIGNING'
  | 'GENERATING'
  | 'EVALUATING'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED_DUPLICATE'
  /** Every candidate was too weak — no thumbnail is offered for upload. */
  | 'REJECTED'
  | 'WAITING';

export type QualityMode = 'FAST' | 'BALANCED' | 'MAX';
export type TextMode = 'LOCAL_OVERLAY' | 'AI_RENDERED' | 'BOTH_FOR_COMPARISON';
export type TextPosition =
  | 'LEFT_TEXT'
  | 'RIGHT_TEXT'
  | 'TOP_TEXT'
  | 'BOTTOM_TEXT'
  | 'CENTER_TEXT';

/** Distinct visual strategies — each must yield a genuinely different picture. */
export type ThumbnailStrategy =
  | 'SUBJECT_CLOSEUP'
  | 'DRAMATIC_SCENE'
  | 'MYSTERY_REVEAL'
  | 'HUMAN_EMOTION'
  | 'SYMBOLIC_METAPHOR'
  | 'OBJECT_HERO'
  | 'CONTRAST_SPLIT'
  | 'SCALE_SHIFT';

export const THUMBNAIL_STRATEGIES: ThumbnailStrategy[] = [
  'SUBJECT_CLOSEUP',
  'DRAMATIC_SCENE',
  'MYSTERY_REVEAL',
  'HUMAN_EMOTION',
  'SYMBOLIC_METAPHOR',
  'OBJECT_HERO',
  'CONTRAST_SPLIT',
  'SCALE_SHIFT',
];

export type StylePreset =
  | 'CINEMATIC_DOCUMENTARY'
  | 'PHOTOREALISTIC'
  | 'MYSTERIOUS'
  | 'HISTORICAL'
  | 'COSMIC'
  | 'SCIENTIFIC'
  | 'DARK_LUXURY'
  | 'ANCIENT_MANUSCRIPT'
  | 'SURREAL_SYMBOLIC'
  | 'HIGH_CONTRAST_EDITORIAL'
  | 'MODERN_DOCUMENTARY'
  | 'EPIC_HISTORICAL';

/** Structured result of the deep script analysis (section 4). */
export interface ScriptAnalysis {
  VIDEO_TITLE: string;
  VIDEO_TOPIC: string;
  CORE_THESIS: string;
  PRIMARY_HOOK: string;
  SECONDARY_HOOK: string;
  EMOTIONAL_CORE: string;
  KEY_CONFLICT: string;
  KEY_QUESTION: string;
  KEY_MYSTERY: string;
  IMPORTANT_PEOPLE: string[];
  IMPORTANT_OBJECTS: string[];
  IMPORTANT_LOCATIONS: string[];
  IMPORTANT_SYMBOLS: string[];
  HISTORICAL_ELEMENTS: string[];
  SCIENTIFIC_ELEMENTS: string[];
  SPIRITUAL_ELEMENTS: string[];
  VISUAL_METAPHORS: string[];
  POSSIBLE_THUMBNAIL_SCENARIOS: string[];
  THUMBNAIL_TEXT_CANDIDATES: string[];
  WHY_THIS_THUMBNAIL_COULD_WORK: string;
  /** Facts literally stated by the script (no invention allowed). */
  FACTUAL_STATEMENTS: string[];
  /** Creative visual interpretations, explicitly not factual claims. */
  CREATIVE_INTERPRETATIONS: string[];
  SUGGESTED_STYLE: StylePreset;
  LANGUAGE: string;
}

/** Scoring dimensions from section 6 — purely visual/communicative. */
export interface DesignScore {
  ATTENTION: number;
  CURIOSITY: number;
  INSTANT_COMPREHENSION: number;
  EMOTIONAL_IMPACT: number;
  VISUAL_CLARITY: number;
  SUBJECT_PROMINENCE: number;
  COMPOSITION: number;
  CONTRAST: number;
  COLOR_DIVERSITY: number;
  SMALL_SCREEN_READABILITY: number;
  TITLE_ALIGNMENT: number;
  NOVELTY: number;
  CLICK_INTENT: number;
  CONTENT_ACCURACY: number;
  VISUAL_SIMPLICITY: number;
}

export interface ThumbnailConcept {
  id: string;
  label: string;
  /** The visual strategy this concept implements. */
  strategy: ThumbnailStrategy;
  idea: string;
  subject: string;
  /** Explicit emotional direction (expression, body language). */
  emotion: string;
  action: string;
  environment: string;
  era: string;
  composition: string;
  camera: string;
  lighting: string;
  color: string;
  mood: string;
  depth: string;
  detail: string;
  visualMetaphor: string;
  textArea: TextPosition;
  style: StylePreset;
  thumbnailText: string;
  unusual: boolean;
  score?: DesignScore;
  scoreTotal?: number;
  rationale?: string;
}

export interface VariantCritique {
  firstImpression: string;
  mainSubject: string;
  topicClear: boolean;
  createsCuriosity: boolean;
  hierarchyClear: boolean;
  textAreaSufficient: boolean;
  textAreaLocation: TextPosition;
  overloaded: boolean;
  looksPremium: boolean;
  looksLikeRealThumbnail: boolean;
  /** Does it feel distinctive or like generic AI/stock output? */
  feelsGeneric: boolean;
  /** Judged on the 320px version that is shown alongside the full image. */
  smallSizeVerdict: string;
  smallSizeReadable: boolean;
  visualContradictions: string[];
  anatomyOrPerspectiveErrors: string[];
  artifacts: string[];
  /** Concrete, fixable defects — input for the refinement pass. */
  defects: string[];
  /** Can the defects be fixed by a targeted edit instead of a regeneration? */
  fixableByEdit: boolean;
  titleImageConnection: string;
  /** Structured reasoning, not just numbers. */
  reasons: string[];
  score: DesignScore;
  scoreTotal: number;
  improvementPrompt: string;
  summary: string;
  /** Was this produced from real image pixels by a vision model? */
  source: 'vision-model' | 'deterministic-mock';
}

/** Result of the head-to-head visual comparison of all surviving candidates. */
export interface VisualRanking {
  order: number[];
  winner: number;
  reason: string;
  perCandidate: Array<{ index: number; verdict: string }>;
  source: 'vision-model' | 'deterministic-mock';
}

export interface GeneratedVariant {
  index: number;
  conceptId: string;
  strategy?: ThumbnailStrategy;
  file: string;
  prompt: string;
  /** What was actually delivered by the provider. */
  model: string;
  quality: string;
  size: string;
  /** What was requested — kept separately so downgrades stay visible. */
  requested?: { model: string; quality: string; size: string };
  degradations?: Array<{ kind: string; requested: string; actual: string; reason: string }>;
  latencyMs?: number;
  /** Stage 1: deterministic local QA on the bare artwork. */
  localQa?: CandidateQaReport;
  /**
   * The composed thumbnail (artwork + headline) for this candidate. This — not
   * the bare artwork — is what the viewer sees, so it is what gets critiqued,
   * ranked and checked at small size.
   */
  compositeFile?: string;
  compositeQa?: CandidateQaReport;
  placement?: {
    position: string;
    reason: string;
    focalOverlap: number | null;
    backdropForced: boolean;
  };
  /** Stage 2: AI critique on the real pixels (only for Stage-1 survivors). */
  critique?: VariantCritique;
  /** Set when the candidate was excluded from the final competition. */
  rejected?: boolean;
  rejectionReason?: string;
  iteration: number;
  refined?: boolean;
}

/** Deterministic Stage-1 quality report for a single candidate. */
export interface CandidateQaReport {
  passed: boolean;
  checks: QaCheck[];
  metrics: {
    width: number;
    height: number;
    aspect: number;
    globalContrast: number;
    safeAreaBusyness: number;
    subjectSeparation: number;
    clutter: number;
    smallSizeDetailRetention: number;
    borderArtifact: number;
    meanLuminance: number;
  };
  /** Perceptual hash used to detect near-duplicate candidates. */
  hash: string;
}

export interface CostEntry {
  jobId: string;
  timestamp: string;
  kind: 'image' | 'analysis';
  model: string;
  quality?: string;
  size?: string;
  count: number;
  estimatedUsd: number;
  estimated: true;
}

export interface JobProgressStep {
  stage: string;
  label: string;
  at: string;
}

export interface Job {
  id: string;
  sourceFile: string;
  fileName: string;
  hash: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  outputDir?: string;
  slug?: string;
  videoTitle?: string;
  thumbnailText?: string;
  thumbnailHook?: string;
  conceptSummary?: string;
  analysis?: ScriptAnalysis;
  concepts?: ThumbnailConcept[];
  variants?: GeneratedVariant[];
  selectedVariant?: number;
  selectionReason?: string;
  ranking?: VisualRanking;
  /** Requested vs. actually used generation configuration. */
  generation?: {
    requestedModel: string;
    actualModel: string;
    requestedQuality: string;
    actualQuality: string;
    qualitySource: 'config' | 'quality-mode';
    requestedSize: string;
    actualSize: string;
    premium: boolean;
    degradations: Array<{ kind: string; requested: string; actual: string; reason: string }>;
    provider: string;
    testMode: boolean;
  };
  rejectedCount?: number;
  finalScore?: number;
  iterationCount: number;
  generationCount: number;
  estimatedCostUsd: number;
  steps: JobProgressStep[];
  error?: JobError;
  qa?: QaReport;
}

export interface JobError {
  message: string;
  stage: string;
  code?: string;
  permanent: boolean;
  at: string;
}

export interface QaCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface QaReport {
  passed: boolean;
  checks: QaCheck[];
  mobilePreview?: string;
}

export interface AppConfig {
  analysisModel: string;
  analysisModelFallback: string;
  imageModel: string;
  fallbackImageModel: string;
  imageProvider: 'openai' | 'google';
  quality: string;
  resolution: string;
  qualityMode: QualityMode;
  variantCount: number;
  maxVariantCount: number;
  /** Overrides the quality mode's minimum acceptable critic score. */
  minThumbnailScore?: number;
  maxCostPerJob: number;
  maxDailyCost: number;
  inputFolder: string;
  outputFolder: string;
  archiveFolder: string;
  failedFolder: string;
  referenceFolder: string;
  defaultLanguage: string;
  textMode: TextMode;
  font: string;
  textPosition: TextPosition | 'AUTO';
  stylePreset: StylePreset | 'AUTO';
  testMode: boolean;
  port: number;
  logLevel: string;
  watcherEnabled: boolean;
}

export interface ChannelProfile {
  channel_name: string;
  default_language: string;
  preferred_aspect_ratio: string;
  preferred_resolution: string;
  visual_style: StylePreset;
  preferred_color_moods: string[];
  preferred_text_style: string;
  preferred_font: string;
  preferred_text_position: TextPosition | 'AUTO';
  preferred_thumbnail_density: 'low' | 'medium' | 'high';
  preferred_subject_size: 'small' | 'medium' | 'large' | 'dominant';
  brand_rules: string[];
  forbidden_elements: string[];
  text_mode: TextMode;
  max_text_words: number;
}

export interface ThumbnailAnalysisFile {
  source_file: string;
  processing_timestamp: string;
  video_title: string;
  thumbnail_hook: string;
  thumbnail_text: string;
  concept_summary: string;
  selected_variant: number;
  selection_reason: string;
  image_model: string;
  analysis_model: string;
  image_provider: string;
  quality: string;
  size: string;
  generation_count: number;
  iteration_count: number;
  candidates_generated: number;
  candidates_rejected: number;
  requested_model: string;
  requested_quality: string;
  requested_size: string;
  quality_source: string;
  premium_mode: boolean;
  quality_degradations: Array<{ kind: string; requested: string; actual: string; reason: string }>;
  visual_ranking: VisualRanking | null;
  critique_source: string;
  final_score: number;
  estimated_cost_usd: number;
  cost_is_estimate: true;
  test_mode: boolean;
  /** True wenn die Bildfläche Platzhalter-Grafik ist (TEST_MODE) — nie veröffentlichen. */
  artwork_is_placeholder: boolean;
  publishable: boolean;
  not_publishable_reason: string | null;
  text_placement: {
    position: string;
    reason: string;
    focal_overlap: number | null;
    backdrop_forced: boolean;
    candidates: unknown[];
  } | null;
  qa: QaReport | null;
  script_analysis: ScriptAnalysis | null;
  concepts: ThumbnailConcept[];
  variants: Array<Omit<GeneratedVariant, 'prompt'> & { prompt: string }>;
  error_information: JobError | null;
}
