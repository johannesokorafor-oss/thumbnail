import { toFile } from 'openai';
import fs from 'node:fs';
import type {
  GeneratedImage,
  ImageProvider,
  ImageRefineRequest,
  ImageRequest,
  QualityDegradation,
} from '../types.js';
import { getOpenAIClient, hasApiKey, listAvailableModels } from './client.js';
import { getConfig, qualityFallbacksBelow } from '../../../config/index.js';
import { formatSize, parseSize, resolveRequestSize, sixteenNineFallbackChain } from '../../../image/size.js';
import { logger } from '../../../utils/logger.js';
import { PermanentError, withRetry } from '../../../utils/retry.js';

function msg(err: unknown): string {
  return String((err as Error)?.message ?? '').toLowerCase();
}

function isUnsupportedParam(err: unknown, param: string): boolean {
  const m = msg(err);
  return m.includes(param) && /unsupported|invalid|not supported|must be one of|does not support/.test(m);
}

function isUnknownModel(err: unknown): boolean {
  const m = msg(err);
  return /model.*(not found|does not exist|unknown)|invalid model|does not have access to model/.test(m);
}

/**
 * OpenAI Images API provider for the GPT Image 2.5 family.
 *
 * Contract:
 *  - the requested model/quality/size are used verbatim whenever the API accepts them
 *  - fallbacks only happen when the caller explicitly allows them
 *  - every deviation is recorded in `degradations` and logged, never hidden
 *  - size fallbacks stay 16:9 so no downstream crop is ever required
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
      // Listing unavailable — let the actual call decide rather than guessing.
      return true;
    }
  }

  /** Resolve the model without ever downgrading silently. */
  private async resolveModel(req: ImageRequest): Promise<{ model: string; degradation?: QualityDegradation }> {
    const cfg = getConfig();
    const requested = req.model ?? cfg.imageModel;
    if (await this.supportsModel(requested)) return { model: requested };

    if (!req.allowModelFallback) {
      throw new PermanentError(
        `Premium-Bildmodell "${requested}" ist für diesen API-Key nicht verfügbar. ` +
          `Es wird bewusst NICHT still auf "${cfg.fallbackImageModel}" ausgewichen. ` +
          `Entweder Modellzugang freischalten oder QUALITY_MODE=FAST wählen.`,
        'PREMIUM_MODEL_UNAVAILABLE',
      );
    }
    if (await this.supportsModel(cfg.fallbackImageModel)) {
      return {
        model: cfg.fallbackImageModel,
        degradation: {
          kind: 'model',
          requested,
          actual: cfg.fallbackImageModel,
          reason: 'Primäres Bildmodell für diesen API-Key nicht verfügbar; Fallback war erlaubt.',
        },
      };
    }
    throw new PermanentError(
      `Weder ${requested} noch ${cfg.fallbackImageModel} sind für diesen API-Key verfügbar.`,
      'MODEL_UNAVAILABLE',
    );
  }

  async generate(req: ImageRequest): Promise<GeneratedImage[]> {
    const openai = getOpenAIClient();
    const started = Date.now();
    const degradations: QualityDegradation[] = [];

    const { model: initialModel, degradation: modelDegradation } = await this.resolveModel(req);
    let model = initialModel;
    if (modelDegradation) {
      degradations.push(modelDegradation);
      logger.warn(`Modellabweichung: ${modelDegradation.requested} -> ${modelDegradation.actual}`, {
        stage: 'image_generation',
        model: modelDegradation.actual,
        job_id: req.jobId,
      });
    }

    const requestedSize = parseSize(req.size);
    const { size: startSize, note } = resolveRequestSize(requestedSize);
    if (note) {
      degradations.push({ kind: 'size', requested: req.size, actual: formatSize(startSize), reason: note });
      logger.warn(note, { stage: 'image_generation', job_id: req.jobId });
    }

    // Size fallbacks stay strictly 16:9; quality fallbacks only when allowed.
    const sizeChain = req.allowQualityFallback
      ? sixteenNineFallbackChain(startSize)
      : [startSize, ...sixteenNineFallbackChain(startSize).slice(1, 3)];
    const qualityChain = [req.quality, ...(req.allowQualityFallback ? qualityFallbacksBelow(req.quality) : [])];

    let lastError: unknown;

    for (const size of sizeChain) {
      for (const quality of qualityChain) {
        try {
          const result = await withRetry(
            async () => {
              const params: Record<string, unknown> = {
                model,
                prompt: req.prompt,
                size: formatSize(size),
                quality,
                n: req.n ?? 1,
                output_format: req.outputFormat ?? 'png',
              };
              if (req.referenceImages?.length) {
                const files = await Promise.all(
                  req.referenceImages.map((p) => toFile(fs.createReadStream(p), undefined, { type: 'image/png' })),
                );
                return openai.images.edit({ ...params, image: files } as never);
              }
              return openai.images.generate(params as never);
            },
            { label: 'images.generate', jobId: req.jobId, retries: 3 },
          );

          const images = await this.decode(result, {
            model,
            quality,
            size: formatSize(size),
            requested: { model: req.model ?? getConfig().imageModel, quality: req.quality, size: req.size },
            degradations: [...degradations],
            started,
          });

          if (quality !== req.quality) {
            const d: QualityDegradation = {
              kind: 'quality',
              requested: req.quality,
              actual: quality,
              reason: 'API hat die angefragte Qualitätsstufe abgelehnt; Fallback war erlaubt.',
            };
            images.forEach((i) => i.degradations.push(d));
            logger.warn(`Qualitätsabweichung: ${req.quality} -> ${quality}`, {
              stage: 'image_generation', model, job_id: req.jobId,
            });
          }
          if (formatSize(size) !== formatSize(startSize)) {
            const d: QualityDegradation = {
              kind: 'size',
              requested: formatSize(startSize),
              actual: formatSize(size),
              reason: 'API hat die angefragte Größe abgelehnt; kleinere 16:9-Stufe verwendet.',
            };
            images.forEach((i) => i.degradations.push(d));
            logger.warn(`Größenabweichung: ${formatSize(startSize)} -> ${formatSize(size)}`, {
              stage: 'image_generation', model, job_id: req.jobId,
            });
          }
          logger.info(
            `Bild erzeugt: model=${model} quality=${quality} size=${formatSize(size)}`,
            { stage: 'image_generation', model, job_id: req.jobId, duration_ms: Date.now() - started, success: true },
          );
          return images;
        } catch (err) {
          lastError = err;
          if (isUnknownModel(err)) {
            const cfg = getConfig();
            if (req.allowModelFallback && model !== cfg.fallbackImageModel) {
              logger.warn(`Modell ${model} abgelehnt – wechsle auf ${cfg.fallbackImageModel}`, {
                stage: 'image_generation', job_id: req.jobId,
              });
              degradations.push({
                kind: 'model', requested: model, actual: cfg.fallbackImageModel,
                reason: 'API hat das Modell abgelehnt; Fallback war erlaubt.',
              });
              model = cfg.fallbackImageModel;
              continue;
            }
            throw new PermanentError(
              `Bildmodell "${model}" wurde von der API abgelehnt. Kein stiller Wechsel im Premium-Modus.`,
              'PREMIUM_MODEL_UNAVAILABLE',
            );
          }
          if (isUnsupportedParam(err, 'quality')) {
            if (!req.allowQualityFallback) {
              throw new PermanentError(
                `Qualitätsstufe "${quality}" wird von "${model}" nicht unterstützt. ` +
                  'Im Premium-Modus wird bewusst nicht still herabgestuft.',
                'PREMIUM_QUALITY_UNAVAILABLE',
              );
            }
            continue; // next quality
          }
          if (isUnsupportedParam(err, 'size')) break; // next (smaller) 16:9 size
          throw err;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Bildgenerierung fehlgeschlagen.');
  }

  /** Targeted refinement of an existing image via the edits endpoint. */
  async refine(req: ImageRefineRequest): Promise<GeneratedImage> {
    const openai = getOpenAIClient();
    const started = Date.now();
    const { model } = await this.resolveModel(req);
    const { size } = resolveRequestSize(parseSize(req.size));

    const result = await withRetry(
      async () => {
        const image = await toFile(req.image, 'artwork.png', { type: 'image/png' });
        return openai.images.edit({
          model,
          image,
          prompt: req.prompt,
          size: formatSize(size),
          quality: req.quality,
          n: 1,
          output_format: req.outputFormat ?? 'png',
        } as never);
      },
      { label: 'images.edit', jobId: req.jobId, retries: 2 },
    );

    const [img] = await this.decode(result, {
      model,
      quality: req.quality,
      size: formatSize(size),
      requested: { model: req.model ?? getConfig().imageModel, quality: req.quality, size: req.size },
      degradations: [],
      started,
    });
    logger.info(`Refinement erzeugt: model=${model} quality=${req.quality}`, {
      stage: 'refinement', model, job_id: req.jobId, duration_ms: Date.now() - started, success: true,
    });
    return img;
  }

  private async decode(
    result: unknown,
    meta: {
      model: string;
      quality: string;
      size: string;
      requested: { model: string; quality: string; size: string };
      degradations: QualityDegradation[];
      started: number;
    },
  ): Promise<GeneratedImage[]> {
    const data = (result as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }).data ?? [];
    if (!data.length) throw new Error('Bild-API lieferte keine Bilddaten zurück.');

    const images: GeneratedImage[] = [];
    for (const item of data) {
      let buf: Buffer;
      if (item.b64_json) {
        buf = Buffer.from(item.b64_json, 'base64');
      } else if (item.url) {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Bild-URL konnte nicht geladen werden (HTTP ${res.status}).`);
        buf = Buffer.from(await res.arrayBuffer());
      } else {
        throw new Error('Bildantwort enthält weder b64_json noch url.');
      }
      if (buf.length < 1024) throw new Error('Bildantwort ist verdächtig klein (vermutlich kein gültiges Bild).');
      images.push({
        data: buf,
        model: meta.model,
        quality: meta.quality,
        size: meta.size,
        revisedPrompt: item.revised_prompt,
        requested: meta.requested,
        degradations: [...meta.degradations],
        latencyMs: Date.now() - meta.started,
      });
    }
    return images;
  }
}
