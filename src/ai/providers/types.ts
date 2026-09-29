/** Provider abstraction — the pipeline must never import a vendor SDK directly. */

export interface ImageRequest {
  prompt: string;
  /** Requested pixel size, e.g. "2560x1440". Providers may downgrade + report back. */
  size: string;
  /** "max" | "xhigh" | "high" | "medium" | "low" */
  quality: string;
  n?: number;
  outputFormat?: 'png' | 'jpeg';
  /** Optional reference images (style guidance only, never 1:1 copies). */
  referenceImages?: string[];
  jobId?: string;
}

export interface GeneratedImage {
  /** Raw PNG/JPEG bytes. */
  data: Buffer;
  model: string;
  quality: string;
  size: string;
  revisedPrompt?: string;
}

export interface ImageProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  /** Verify the configured model id actually exists for this account. */
  supportsModel(model: string): Promise<boolean>;
  generate(req: ImageRequest): Promise<GeneratedImage[]>;
}

export interface TextRequest {
  system: string;
  user: string;
  /** JSON schema name used when structured output is required. */
  jsonSchemaName?: string;
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  jobId?: string;
  /** Local image files the model should look at (visual critique). */
  images?: string[];
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
