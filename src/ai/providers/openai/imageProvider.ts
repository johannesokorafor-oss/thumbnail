import { toFile } from 'openai';
import fs from 'node:fs';
import type { GeneratedImage, ImageProvider, ImageRequest } from '../types.js';
import { getOpenAIClient, hasApiKey, listAvailableModels } from './client.js';
import { getConfig, IMAGE_QUALITY_FALLBACK_CHAIN } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { PermanentError, withRetry } from '../../../utils/retry.js';

/** Sizes the current Images API is known to accept, ordered by preference. */
const SIZE_FALLBACKS = ['1536x1024', '1792x1024', 'auto'];

function isUnsupportedParam(err: unknown, param: string): boolean {
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  return msg.includes(param) && /unsupported|invalid|not supported|must be one of/.test(msg);
}

function isUnknownModel(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  return /model.*(not found|does not exist|unknown)|invalid model/.test(msg);
}

/**
 * OpenAI Images API provider.
 * Model id, quality and size are configuration — never hard-coded in the pipeline.
 * Degrades gracefully: model -> fallback model, quality chain, size chain.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly id = 'openai';

  async isAvailable(): Promise<boolean> {
    if (!hasApiKey()) return false;
    try {
      await listAvailableModels();
      return true;
    } catch {
      return false;
    }
  }

  async supportsModel(model: string): Promise<boolean> {
    try {
      const models = await listAvailableModels();
      return models.has(model);
    } catch {
      // If the listing endpoint is unavailable we optimistically try the call itself.
      return true;
    }
  }

  private async resolveModel(): Promise<string> {
    const cfg = getConfig();
    if (await this.supportsModel(cfg.imageModel)) return cfg.imageModel;
    logger.warn(`Bildmodell ${cfg.imageModel} nicht verfügbar – nutze Fallback ${cfg.fallbackImageModel}`, {
      stage: 'image_generation',
      model: cfg.imageModel,
    });
    if (await this.supportsModel(cfg.fallbackImageModel)) return cfg.fallbackImageModel;
    throw new PermanentError(
      `Weder ${cfg.imageModel} noch ${cfg.fallbackImageModel} sind für diesen API-Key verfügbar.`,
      'MODEL_UNAVAILABLE',
    );
  }

  async generate(req: ImageRequest): Promise<GeneratedImage[]> {
    const openai = getOpenAIClient();
    let model = await this.resolveModel();

    const qualityChain = [req.quality, ...IMAGE_QUALITY_FALLBACK_CHAIN.filter((q) => q !== req.quality)];
    const sizeChain = [req.size, ...SIZE_FALLBACKS.filter((s) => s !== req.size)];
    let lastError: unknown;

    for (const size of sizeChain) {
      for (const quality of qualityChain) {
        try {
          const result = await withRetry(
            async () => {
              const params: Record<string, unknown> = {
                model,
                prompt: req.prompt,
                size,
                quality,
                n: req.n ?? 1,
                output_format: req.outputFormat ?? 'png',
              };
              if (req.referenceImages?.length) {
                const files = await Promise.all(
                  req.referenceImages.map((p) => toFile(fs.createReadStream(p), undefined, { type: 'image/png' })),
                );
                // Reference images use the edits endpoint for style guidance.
                return openai.images.edit({ ...params, image: files } as never);
              }
              return openai.images.generate(params as never);
            },
            { label: 'images.generate', jobId: req.jobId, retries: 3 },
          );

          const data = (result as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }).data ?? [];
          if (!data.length) throw new Error('Bild-API lieferte keine Bilddaten zurück.');

          const images: GeneratedImage[] = [];
          for (const item of data) {
            let buf: Buffer;
            if (item.b64_json) {
              buf = Buffer.from(item.b64_json, 'base64');
            } else if (item.url) {
              const res = await fetch(item.url);
              buf = Buffer.from(await res.arrayBuffer());
            } else {
              throw new Error('Bildantwort enthält weder b64_json noch url.');
            }
            images.push({ data: buf, model, quality, size, revisedPrompt: item.revised_prompt });
          }
          if (size !== req.size || quality !== req.quality) {
            logger.warn(`Bildparameter herabgestuft: size=${size}, quality=${quality}`, {
              stage: 'image_generation',
              model,
            });
          }
          return images;
        } catch (err) {
          lastError = err;
          if (isUnknownModel(err)) {
            const cfg = getConfig();
            if (model !== cfg.fallbackImageModel) {
              logger.warn(`Modell ${model} abgelehnt – wechsle auf ${cfg.fallbackImageModel}`, { stage: 'image_generation' });
              model = cfg.fallbackImageModel;
              continue;
            }
            throw new PermanentError(`Bildmodell nicht verfügbar: ${model}`, 'MODEL_UNAVAILABLE');
          }
          if (isUnsupportedParam(err, 'quality')) continue;
          if (isUnsupportedParam(err, 'size')) break; // next size
          throw err;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Bildgenerierung fehlgeschlagen.');
  }
}
