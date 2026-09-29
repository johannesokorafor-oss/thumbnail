import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  findNearDuplicates,
  hammingDistance,
  perceptualHash,
  runCandidateQa,
} from '../src/image/validation/candidateQa.js';

const W = 1920;
const H = 1080;

/** Flat, featureless image: no subject, no contrast. */
async function flatImage(): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .png()
    .toBuffer();
}

/**
 * A crude but realistic "good" thumbnail: dark calm right side for the headline,
 * one high-contrast, detailed subject on the left.
 */
async function subjectImage(): Promise<Buffer> {
  const detail = Array.from({ length: 40 }, (_, i) => {
    const x = 120 + (i % 8) * 60;
    const y = 200 + Math.floor(i / 8) * 130;
    return `<rect x="${x}" y="${y}" width="46" height="110" fill="${i % 2 ? '#ffffff' : '#101014'}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#13161c"/>
    <ellipse cx="480" cy="540" rx="380" ry="440" fill="#f2c14a"/>
    ${detail}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('Kandidaten-QA misst echte Pixel', () => {
  it('erkennt ein flaches, motivloses Bild als ungenügend', async () => {
    const report = await runCandidateQa({
      image: await flatImage(),
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
    });
    expect(report.passed).toBe(false);
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failed).toContain('global_contrast');
    expect(report.metrics.globalContrast).toBeLessThan(5);
  });

  it('lässt ein Bild mit klarem Motiv und ruhiger Textfläche passieren', async () => {
    const report = await runCandidateQa({
      image: await subjectImage(),
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
    });
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failed).not.toContain('global_contrast');
    expect(failed).not.toContain('subject_separation');
    expect(failed).not.toContain('text_safe_area');
    expect(report.metrics.subjectSeparation).toBeGreaterThan(1.25);
  });

  it('erkennt ein falsches Seitenverhältnis', async () => {
    const square = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 10, g: 10, b: 10 } } })
      .png()
      .toBuffer();
    const report = await runCandidateQa({ image: square, targetSize: `${W}x${H}`, textArea: 'RIGHT_TEXT' });
    expect(report.checks.find((c) => c.name === 'aspect_16_9')?.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('bewertet die Textfläche abhängig von der geplanten Position', async () => {
    const image = await subjectImage(); // Motiv links, Detail links
    const right = await runCandidateQa({ image, targetSize: `${W}x${H}`, textArea: 'RIGHT_TEXT' });
    const left = await runCandidateQa({ image, targetSize: `${W}x${H}`, textArea: 'LEFT_TEXT' });
    expect(right.metrics.safeAreaBusyness).toBeLessThan(left.metrics.safeAreaBusyness);
  });

  it('liefert reproduzierbare Messwerte für dasselbe Bild', async () => {
    const image = await subjectImage();
    const a = await runCandidateQa({ image, targetSize: `${W}x${H}`, textArea: 'RIGHT_TEXT' });
    const b = await runCandidateQa({ image, targetSize: `${W}x${H}`, textArea: 'RIGHT_TEXT' });
    expect(a.metrics).toEqual(b.metrics);
    expect(a.hash).toBe(b.hash);
  });
});

describe('Duplikaterkennung', () => {
  it('erkennt identische Bilder als Duplikat', async () => {
    const image = await subjectImage();
    const h1 = await perceptualHash(image);
    const h2 = await perceptualHash(image);
    expect(hammingDistance(h1, h2)).toBe(0);
  });

  it('unterscheidet deutlich verschiedene Bilder', async () => {
    const a = await perceptualHash(await subjectImage());
    const b = await perceptualHash(await flatImage());
    expect(hammingDistance(a, b)).toBeGreaterThan(18);
  });

  it('verwirft das schwächere von zwei nahezu identischen Kandidaten', () => {
    const dupes = findNearDuplicates([
      { index: 1, hash: 'ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000', score: 9 },
      { index: 2, hash: 'ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000', score: 5 },
      { index: 3, hash: '0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff', score: 7 },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].index).toBe(2);
    expect(dupes[0].duplicateOf).toBe(1);
  });
});
