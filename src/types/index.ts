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
  | 'WAITING';

export type QualityMode = 'FAST' | 'BALANCED' | 'MAX';
export type TextMode = 'LOCAL_OVERLAY' | 'AI_RENDERED' | 'BOTH_FOR_COMPARISON';
export type TextPosition =
  | 'LEFT_TEXT'
  | 'RIGHT_TEXT'
  | 'TOP_TEXT'
  | 'BOTTOM_TEXT'
  | 'CENTER_TEXT';

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
  idea: string;
  subject: string;
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
  visualContradictions: string[];
  anatomyOrPerspectiveErrors: string[];
  artifacts: string[];
  titleImageConnection: string;
  score: DesignScore;
  scoreTotal: number;
  improvementPrompt: string;
  summary: string;
}

export interface GeneratedVariant {
  index: number;
  conceptId: string;
  file: string;
  prompt: string;
  model: string;
  quality: string;
  size: string;
  critique?: VariantCritique;
  iteration: number;
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
  final_score: number;
  estimated_cost_usd: number;
  cost_is_estimate: true;
  test_mode: boolean;
  qa: QaReport | null;
  script_analysis: ScriptAnalysis | null;
  concepts: ThumbnailConcept[];
  variants: Array<Omit<GeneratedVariant, 'prompt'> & { prompt: string }>;
  error_information: JobError | null;
}
