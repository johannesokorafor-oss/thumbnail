/** Provider abstraction — the pipeline must never import a vendor SDK directly. */

export interface ImageRequest {
  prompt: string;
  /** Requested pixel size, e.g. "2560x1440". Always 16:9 for thumbnails. */
  size: string;
  /** "low" | "medium" | "high" | "xhigh" | "max" */
  quality: string;
  n?: number;
  outputFormat?: 'png' | 'jpeg';
  /** Optional reference images (style guidance only, never 1:1 copies). */
  referenceImages?: string[];
  jobId?: string;
  /**
   * Premium contract: when false (default), the provider must not step the
   * quality down or switch the model. It fails loudly instead.
   */
  allowQualityFallback?: boolean;
  allowModelFallback?: boolean;
  /** Pin a specific model instead of the configured default. */
  model?: string;
}

/** A single, explicitly recorded deviation from the requested configuration. */
export interface QualityDegradation {
  kind: 'model' | 'quality' | 'size';
  requested: string;
  actual: string;
  reason: string;
}

export interface GeneratedImage {
  /** Raw PNG/JPEG bytes. */
  data: Buffer;
  model: string;
  quality: string;
  size: string;
  revisedPrompt?: string;
  /** What was asked for — kept next to what was delivered. */
  requested: { model: string; quality: string; size: string };
  /** Empty when the premium configuration was honoured exactly. */
  degradations: QualityDegradation[];
  latencyMs: number;
}

/** Targeted refinement of an existing image (OpenAI images.edit). */
export interface ImageRefineRequest extends ImageRequest {
  /** The image to refine, as raw bytes. */
  image: Buffer;
  /** Short, specific instruction describing what to change. */
  instruction: string;
}

export interface ImageProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  /** Verify the configured model id actually exists for this account. */
  supportsModel(model: string): Promise<boolean>;
  generate(req: ImageRequest): Promise<GeneratedImage[]>;
  /** Optional: targeted edit of an existing image. */
  refine?(req: ImageRefineRequest): Promise<GeneratedImage>;
}

export interface TextRequest {
  system: string;
  user: string;
  /** JSON schema name used when structured output is required. */
  jsonSchemaName?: string;
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  jobId?: string;
  /** Images the model should actually look at (real pixels, already downscaled). */
  images?: Array<string | { data: Buffer; label?: string }>;
}

export interface TextResult {
  text: string;
  model: string;
}

export interface TextProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  complete(req: TextRequest): Promise<TextResult>;
  /** Structured JSON helper — returns parsed object. */
  completeJson<T>(req: TextRequest): Promise<{ value: T; model: string }>;
}
