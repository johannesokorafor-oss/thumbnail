import type { GeneratedImage, ImageProvider, ImageRequest } from '../types.js';
import { PermanentError } from '../../../utils/retry.js';

/**
 * Placeholder for Google Gemini image generation (section 35).
 * The interface is already wired into the registry, so enabling it later only
 * requires implementing `generate()` — no pipeline changes.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly id = 'google';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async supportsModel(): Promise<boolean> {
    return false;
  }

  async generate(_req: ImageRequest): Promise<GeneratedImage[]> {
    throw new PermanentError(
      'Der Google-Gemini-Bildprovider ist vorbereitet, aber in Version 1 noch nicht implementiert. Bitte IMAGE_PROVIDER=openai verwenden.',
      'PROVIDER_NOT_IMPLEMENTED',
    );
  }
}
