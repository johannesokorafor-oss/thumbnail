import fs from 'node:fs';
import path from 'node:path';
import type { TextProvider, TextRequest, TextResult } from '../types.js';
import { getOpenAIClient, hasApiKey, listAvailableModels } from './client.js';
import { getConfig } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { withRetry } from '../../../utils/retry.js';

function mime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Modellantwort enthielt kein gültiges JSON.');
  }
}

/**
 * Analysis/critique provider built on the OpenAI Responses API.
 * Falls back to the configured cheaper model if the primary one is unavailable.
 */
export class OpenAITextProvider implements TextProvider {
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

  private async resolveModel(): Promise<string> {
    const cfg = getConfig();
    try {
      const models = await listAvailableModels();
      if (models.has(cfg.analysisModel)) return cfg.analysisModel;
      if (models.has(cfg.analysisModelFallback)) {
        logger.warn(`Analysemodell ${cfg.analysisModel} nicht verfügbar – nutze ${cfg.analysisModelFallback}`, {
          stage: 'analysis',
        });
        return cfg.analysisModelFallback;
      }
    } catch {
      /* listing failed — just try the configured model */
    }
    return cfg.analysisModel;
  }

  private buildInput(req: TextRequest) {
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: req.user }];
    for (const img of req.images ?? []) {
      if (typeof img === 'string') {
        if (!fs.existsSync(img)) continue;
        const b64 = fs.readFileSync(img).toString('base64');
        content.push({ type: 'input_image', image_url: `data:${mime(img)};base64,${b64}` });
      } else {
        // In-memory buffer: already downscaled by the caller to keep requests small.
        if (img.label) content.push({ type: 'input_text', text: img.label });
        content.push({
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${img.data.toString('base64')}`,
        });
      }
    }
    return [
      { role: 'system', content: req.system },
      { role: 'user', content },
    ];
  }

  async complete(req: TextRequest): Promise<TextResult> {
    const openai = getOpenAIClient();
    let model = await this.resolveModel();
    const cfg = getConfig();

    const run = async (useModel: string) =>
      withRetry(
        async () => {
          const res = await openai.responses.create({
            model: useModel,
            input: this.buildInput(req) as never,
            max_output_tokens: req.maxOutputTokens ?? 6000,
            ...(req.schema
              ? {
                  text: {
                    format: {
                      type: 'json_schema',
                      name: req.jsonSchemaName ?? 'result',
                      strict: false,
                      schema: req.schema,
                    },
                  },
                }
              : {}),
          } as never);
          const text = (res as { output_text?: string }).output_text ?? '';
          if (!text) throw new Error('Leere Modellantwort.');
          return { text, model: useModel } satisfies TextResult;
        },
        { label: 'responses.create', jobId: req.jobId, retries: 3 },
      );

    try {
      return await run(model);
    } catch (err) {
      if (model !== cfg.analysisModelFallback) {
        logger.warn(`Analysemodell ${model} fehlgeschlagen – Fallback ${cfg.analysisModelFallback}`, {
          stage: 'analysis',
          error: (err as Error).message,
        });
        model = cfg.analysisModelFallback;
        return run(model);
      }
      throw err;
    }
  }

  async completeJson<T>(req: TextRequest): Promise<{ value: T; model: string }> {
    const res = await this.complete(req);
    return { value: extractJson(res.text) as T, model: res.model };
  }
}

export { extractJson };
