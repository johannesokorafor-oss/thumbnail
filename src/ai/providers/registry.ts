import type { ImageProvider, TextProvider } from './types.js';
import { OpenAIImageProvider } from './openai/imageProvider.js';
import { OpenAITextProvider } from './openai/textProvider.js';
import { GeminiImageProvider } from './google/geminiImageProvider.js';
import { MockImageProvider, MockTextProvider } from './mock/index.js';
import { getConfig } from '../../config/index.js';

const imageProviders: Record<string, () => ImageProvider> = {
  openai: () => new OpenAIImageProvider(),
  google: () => new GeminiImageProvider(),
  mock: () => new MockImageProvider(),
};

/** Resolve the active providers from config; TEST_MODE always wins. */
export function getImageProvider(): ImageProvider {
  const cfg = getConfig();
  if (cfg.testMode) return new MockImageProvider();
  const factory = imageProviders[cfg.imageProvider] ?? imageProviders.openai;
  return factory();
}

export function getTextProvider(): TextProvider {
  const cfg = getConfig();
  if (cfg.testMode) return new MockTextProvider();
  return new OpenAITextProvider();
}

export function listImageProviderIds(): string[] {
  return Object.keys(imageProviders);
}
