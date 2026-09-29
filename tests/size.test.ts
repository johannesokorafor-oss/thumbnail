import { describe, expect, it } from 'vitest';
import {
  EDGE_MULTIPLE,
  MAX_EDGE,
  MAX_PIXELS,
  MIN_PIXELS,
  SIXTEEN_NINE_LADDER,
  formatSize,
  isSixteenNine,
  parseSize,
  resolveRequestSize,
  sixteenNineFallbackChain,
  snapToApiSize,
  validateApiSize,
} from '../src/image/size.js';

describe('API-Größenregeln', () => {
  it('akzeptiert die dokumentierten 16:9-Größen', () => {
    for (const size of SIXTEEN_NINE_LADDER) {
      const v = validateApiSize(size);
      expect(v.valid, `${formatSize(size)}: ${v.problems.join(' ')}`).toBe(true);
      expect(isSixteenNine(size)).toBe(true);
      expect(size.width % EDGE_MULTIPLE).toBe(0);
      expect(size.height % EDGE_MULTIPLE).toBe(0);
      expect(size.width).toBeLessThanOrEqual(MAX_EDGE);
      expect(size.width * size.height).toBeGreaterThanOrEqual(MIN_PIXELS);
      expect(size.width * size.height).toBeLessThanOrEqual(MAX_PIXELS);
    }
  });

  it('lehnt Kanten ab, die kein Vielfaches von 16 sind', () => {
    expect(validateApiSize({ width: 1537, height: 864 }).valid).toBe(false);
  });

  it('erkennt, dass ausgerechnet 1920x1080 NICHT API-konform ist (1080 ist kein Vielfaches von 16)', () => {
    expect(validateApiSize({ width: 1920, height: 1080 }).valid).toBe(false);
    const resolved = resolveRequestSize({ width: 1920, height: 1080 });
    expect(validateApiSize(resolved.size).valid).toBe(true);
    expect(resolved.note).toBeTruthy();
  });

  it('lehnt zu große und zu kleine Bilder ab', () => {
    expect(validateApiSize({ width: 4096, height: 2304 }).valid).toBe(false);
    expect(validateApiSize({ width: 640, height: 368 }).valid).toBe(false);
  });

  it('lehnt Seitenverhältnisse jenseits 3:1 ab', () => {
    expect(validateApiSize({ width: 3840, height: 1024 }).valid).toBe(false);
  });

  it('rastet krumme Größen auf gültige Vielfache', () => {
    const snapped = snapToApiSize({ width: 2555, height: 1437 });
    expect(snapped.width % EDGE_MULTIPLE).toBe(0);
    expect(snapped.height % EDGE_MULTIPLE).toBe(0);
    expect(validateApiSize(snapped).valid).toBe(true);
  });

  it('1536x864 ist gültig und bleibt 16:9', () => {
    expect(validateApiSize({ width: 1536, height: 864 }).valid).toBe(true);
    expect(isSixteenNine({ width: 1536, height: 864 })).toBe(true);
  });
});

describe('16:9-Fallback-Kette', () => {
  it('enthält ausschließlich 16:9-Größen – ein Downgrade kann nie zuschneiden', () => {
    const chain = sixteenNineFallbackChain({ width: 2560, height: 1440 });
    expect(chain.length).toBeGreaterThan(1);
    for (const size of chain) {
      expect(isSixteenNine(size), formatSize(size)).toBe(true);
      expect(validateApiSize(size).valid).toBe(true);
    }
  });

  it('wird monoton kleiner und beginnt bei der Zielgröße', () => {
    const chain = sixteenNineFallbackChain({ width: 2560, height: 1440 });
    expect(formatSize(chain[0])).toBe('2560x1440');
    const pixels = chain.map((s) => s.width * s.height);
    expect([...pixels].sort((a, b) => b - a)).toEqual(pixels);
  });

  it('eskaliert nie über die angeforderte Größe hinaus', () => {
    const chain = sixteenNineFallbackChain({ width: 2048, height: 1152 });
    expect(chain.every((s) => s.width <= 2048)).toBe(true);
  });
});

describe('resolveRequestSize', () => {
  it('lässt eine gültige Zielgröße unverändert und ohne Hinweis', () => {
    const res = resolveRequestSize({ width: 2560, height: 1440 });
    expect(formatSize(res.size)).toBe('2560x1440');
    expect(res.note).toBeUndefined();
  });

  it('korrigiert eine ungültige Zielgröße und meldet das ausdrücklich', () => {
    const res = resolveRequestSize({ width: 2561, height: 1441 });
    expect(validateApiSize(res.size).valid).toBe(true);
    expect(res.note).toBeTruthy();
  });

  it('parst Größenangaben robust', () => {
    expect(formatSize(parseSize('1920x1080'))).toBe('1920x1080');
    expect(formatSize(parseSize('unsinn'))).toBe('2560x1440');
  });
});
