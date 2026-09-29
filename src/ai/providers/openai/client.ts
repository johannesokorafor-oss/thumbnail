import OpenAI from 'openai';
import { PermanentError } from '../../../utils/retry.js';

let client: OpenAI | null = null;

/** Key is read from the environment only — never from the browser or source. */
export function getOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new PermanentError(
      'OPENAI_API_KEY fehlt. Trage den Key in die .env ein oder aktiviere TEST_MODE.',
      'MISSING_API_KEY',
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 180_000 });
  }
  return client;
}

export function resetOpenAIClient(): void {
  client = null;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

let modelCache: Set<string> | null = null;

/** Detect whether a configured model id is actually available (sections 11/12). */
export async function listAvailableModels(): Promise<Set<string>> {
  if (modelCache) return modelCache;
  const openai = getOpenAIClient();
  const ids = new Set<string>();
  const page = await openai.models.list();
  for (const m of page.data) ids.add(m.id);
  modelCache = ids;
  return ids;
}

export function clearModelCache(): void {
  modelCache = null;
}
