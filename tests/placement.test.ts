import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { choosePlacement, findFocalRegion } from '../src/image/overlay/placement.js';
import { pickAccentHue, analyzeRegion, deriveTextColors } from '../src/image/overlay/colorAnalysis.js';

const W = 1600;
const H = 900;

/** Detailed subject on one side, calm gradient on the other. */
async function sidedImage(side: 'left' | 'right'): Promise<Buffer> {
  const cx = side === 'left' ? 420 : W - 420;
  const detail = Array.from({ length: 48 }, (_, i) => {
    const x = cx - 220 + (i % 8) * 55;
    const y = 220 + Math.floor(i / 8) * 80;
    return `<rect x="${x}" y="${y}" width="40" height="60" fill="${i % 2 ? '#ffffff' : '#0a0a0c'}"/>`;
  }).join('');
  return sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="#181c24"/>
      <ellipse cx="${cx}" cy="${H / 2}" rx="300" ry="360" fill="#e8b23a"/>
      ${detail}
    </svg>`),
  )
    .png()
    .toBuffer();
}

describe('Inhaltsbewusste Textplatzierung', () => {
  it('findet das Hauptmotiv auf der richtigen Bildseite', async () => {
    const focal = await findFocalRegion(await sidedImage('left'));
    expect(focal.left + focal.width / 2).toBeLessThan(W / 2);
    expect(focal.strength).toBeGreaterThan(0.2);
  });

  it('korrigiert eine Textfläche, die auf dem Motiv liegen würde', async () => {
    // Motiv links, Konzept will aber links Text setzen -> muss nach rechts korrigiert werden.
    const result = await choosePlacement(await sidedImage('left'), 'LEFT_TEXT');
    expect(result.overrodePreference).toBe(true);
    expect(result.position).toBe('RIGHT_TEXT');
    expect(result.reason).toMatch(/korrigiert/);
  });

  it('bestätigt eine bereits sinnvolle Textfläche', async () => {
    const result = await choosePlacement(await sidedImage('left'), 'RIGHT_TEXT');
    expect(result.overrodePreference).toBe(false);
    expect(result.position).toBe('RIGHT_TEXT');
  });

  it('spiegelt die Entscheidung, wenn das Motiv auf der anderen Seite sitzt', async () => {
    const result = await choosePlacement(await sidedImage('right'), 'RIGHT_TEXT');
    expect(result.position).toBe('LEFT_TEXT');
    expect(result.overrodePreference).toBe(true);
  });

  it('wählt eine Fläche mit deutlich geringerer Motivüberlappung', async () => {
    const result = await choosePlacement(await sidedImage('left'), 'LEFT_TEXT');
    const chosen = result.scores.find((s) => s.position === result.position)!;
    const rejected = result.scores.find((s) => s.position === 'LEFT_TEXT')!;
    expect(chosen.focalOverlap).toBeLessThan(rejected.focalOverlap);
  });

  it('respektiert eine manuell erzwungene Position', async () => {
    const result = await choosePlacement(await sidedImage('left'), 'LEFT_TEXT', { allowOverride: false });
    expect(result.position).toBe('LEFT_TEXT');
  });

  it('erzwingt den Kontrast-Hintergrund, wenn keine freie Fläche existiert', async () => {
    // Bild mit Details über die gesamte Fläche: jede Textfläche überlappt.
    const noisy = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4"/></filter>
        <rect width="100%" height="100%" filter="url(#n)"/>
      </svg>`),
    )
      .png()
      .toBuffer();
    const result = await choosePlacement(noisy, 'RIGHT_TEXT');
    expect(result.needsBackdrop).toBe(true);
  });
});

describe('Akzentfarbe kollidiert nicht mit dem Bild', () => {
  it('meidet den Farbton des Motivs statt ihn zu treffen', async () => {
    // Grünes Motiv auf violettem Grund: die Komplementärfarbe von Violett ist
    // ausgerechnet Grün - genau die Farbe des Motivs.
    const image = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <rect width="100%" height="100%" fill="#4a1060"/>
        <circle cx="500" cy="450" r="260" fill="#2ee85f"/>
      </svg>`),
    )
      .png()
      .toBuffer();

    const hue = await pickAccentHue(image);
    const hueDistance = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    expect(hueDistance(hue, 137)).toBeGreaterThan(40); // nicht das Grün des Motivs
    expect(hueDistance(hue, 285)).toBeGreaterThan(40); // nicht das Violett des Hintergrunds

    const stats = await analyzeRegion(image, { left: 900, top: 200, width: 600, height: 500 });
    const withFree = deriveTextColors(stats, undefined, hue).accent;
    expect(withFree).toContain(`hsl(${hue}`);
  });

  it('liefert auch für ein farbloses Bild einen brauchbaren Akzent', async () => {
    const grey = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 90, g: 90, b: 90 } } })
      .png()
      .toBuffer();
    const hue = await pickAccentHue(grey);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
