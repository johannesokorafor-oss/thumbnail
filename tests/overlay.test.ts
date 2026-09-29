import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fitFontSize, renderTextOverlay, wrapText } from '../src/image/overlay/textOverlay.js';
import { deriveTextColors, safeAreaRect } from '../src/image/overlay/colorAnalysis.js';
import { runQualityAssurance } from '../src/image/validation/qa.js';
import { normalizeToTarget, parseSize, toJpeg } from '../src/image/processing/normalize.js';

async function artwork(width = 1280, height = 720, color = { r: 12, g: 20, b: 34 }) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><circle cx="${width * 0.3}" cy="${height * 0.5}" r="${height * 0.33}" fill="#e0a355"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

describe('Typografie', () => {
  it('bricht Text in Zeilen um', () => {
    const lines = wrapText('DAS VERBOTENE WISSEN DER ALCHEMIE', 600, 80);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('findet eine passende Schriftgröße', () => {
    const { fontSize, lines } = fitFontSize('DAS VERBOTENE WISSEN', 900, 400);
    expect(fontSize).toBeGreaterThan(20);
    expect(lines.join(' ')).toBe('DAS VERBOTENE WISSEN');
  });

  it('leitet Safe-Area-Rechtecke ab', () => {
    const r = safeAreaRect('RIGHT_TEXT', 2560, 1440);
    expect(r.left).toBeGreaterThan(1280);
    expect(r.width).toBeGreaterThan(500);
  });

  it('wählt helle Schrift auf dunklem Grund und umgekehrt', () => {
    const dark = deriveTextColors({ meanLuminance: 20, stdLuminance: 10, dominant: { r: 10, g: 20, b: 40 }, isDark: true, busy: false });
    expect(dark.fill).toBe('#FFFFFF');
    const light = deriveTextColors({ meanLuminance: 220, stdLuminance: 10, dominant: { r: 240, g: 230, b: 200 }, isDark: false, busy: false });
    expect(light.fill).toBe('#0B0B0D');
  });

  it('rendert ein Overlay und verändert dabei den Textbereich', async () => {
    const art = await artwork();
    const res = await renderTextOverlay(art, { text: 'Das verbotene Wissen', position: 'RIGHT_TEXT' });
    const meta = await sharp(res.image).metadata();
    expect(meta.width).toBe(1280);
    expect(res.lines.join(' ')).toContain('DAS VERBOTENE');
    expect(res.image.equals(art)).toBe(false);
  });
});

describe('Bildverarbeitung & QA', () => {
  it('normalisiert auf exakt 16:9-Zielauflösung', async () => {
    const art = await artwork(1024, 1024);
    const out = await normalizeToTarget(art, parseSize('2560x1440'));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(2560);
    expect(meta.height).toBe(1440);
  });

  it('erzeugt lesbares JPEG', async () => {
    const jpg = await toJpeg(await artwork());
    expect((await sharp(jpg).metadata()).format).toBe('jpeg');
  });

  it('führt die Qualitätskontrolle durch und erkennt vorhandenen Text', async () => {
    const art = await normalizeToTarget(await artwork(), parseSize('2560x1440'));
    const overlay = await renderTextOverlay(art, { text: 'SIE WUSSTEN MEHR', position: 'RIGHT_TEXT' });
    const report = await runQualityAssurance({
      finalImage: overlay.image,
      cleanArt: art,
      targetSize: '2560x1440',
      expectText: true,
      textPosition: 'RIGHT_TEXT',
    });
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName.aspect_16_9.passed).toBe(true);
    expect(byName.resolution.passed).toBe(true);
    expect(byName.text_present.passed).toBe(true);
    expect(byName.not_blank.passed).toBe(true);
  });

  it('erkennt ein leeres Bild als fehlerhaft', async () => {
    const blank = await sharp({ create: { width: 2560, height: 1440, channels: 3, background: '#101010' } }).png().toBuffer();
    const report = await runQualityAssurance({
      finalImage: blank, cleanArt: blank, targetSize: '2560x1440', expectText: false, textPosition: 'RIGHT_TEXT',
    });
    expect(report.passed).toBe(false);
  });
});
