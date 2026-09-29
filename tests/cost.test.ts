import { describe, expect, it } from 'vitest';
import { estimateImageCost } from '../src/pipeline/costTracker.js';

describe('Kostenschätzung', () => {
  it('skaliert mit Qualität und Anzahl', () => {
    const one = estimateImageCost('gpt-image-2.5-sunburst', 'max', 1, '2560x1440');
    const four = estimateImageCost('gpt-image-2.5-sunburst', 'max', 4, '2560x1440');
    const cheap = estimateImageCost('gpt-image-2.5-sunburst', 'high', 1, '2560x1440');
    expect(four).toBeCloseTo(one * 4, 4);
    expect(cheap).toBeLessThan(one);
  });

  it('nutzt eine Default-Preistabelle für unbekannte Modelle', () => {
    expect(estimateImageCost('irgendein-modell', 'high', 1)).toBeGreaterThan(0);
  });
});
