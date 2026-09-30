import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { runCandidateQa } from '../src/image/validation/candidateQa.js';

const W = 1280;
const H = 720;

/** Artwork with a calm right half and a detailed left half. */
async function artwork(): Promise<Buffer> {
  const dots = Array.from({ length: 120 }, (_, i) => {
    const x = 40 + ((i * 37) % 560);
    const y = 40 + ((i * 53) % 640);
    return `<circle cx="${x}" cy="${y}" r="14" fill="#f2c94c"/>`;
  }).join('');
  return sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="#101b2b"/>${dots}</svg>`),
  )
    .png()
    .toBuffer();
}

/** The same artwork with a bright headline burned into the right half. */
async function composite(): Promise<Buffer> {
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text x="700" y="330" font-family="sans-serif" font-size="96" font-weight="bold" fill="#ffffff">TITEL</text>
    <text x="700" y="440" font-family="sans-serif" font-size="96" font-weight="bold" fill="#ffffff">ZEILE</text>
  </svg>`;
  return sharp(await artwork())
    .composite([{ input: Buffer.from(text) }])
    .png()
    .toBuffer();
}

describe('QA am fertigen Gesamtbild', () => {
  it('prüft am Artwork, ob die Textfläche frei ist', async () => {
    const report = await runCandidateQa({
      image: await artwork(),
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
      mode: 'artwork',
    });
    const names = report.checks.map((c) => c.name);
    expect(names).toContain('text_safe_area');
    expect(names).not.toContain('text_legibility_small');
    // Die rechte Hälfte ist ruhig — die freie Fläche muss anerkannt werden.
    expect(report.checks.find((c) => c.name === 'text_safe_area')?.passed).toBe(true);
  });

  it('bestraft das Gesamtbild NICHT dafür, dass dort Text steht', async () => {
    // Regression: die Detaildichte-Prüfung der Textfläche schlug am Gesamtbild
    // immer fehl, weil die Schrift selbst die gemessene Detaildichte ist.
    const report = await runCandidateQa({
      image: await composite(),
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
      mode: 'composite',
    });
    expect(report.checks.map((c) => c.name)).not.toContain('text_safe_area');
    expect(report.checks.find((c) => c.name === 'text_legibility_small')?.passed).toBe(true);
  });

  it('erkennt unlesbaren Text: heller Text auf hellem Grund', async () => {
    const washedOut = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <rect width="100%" height="100%" fill="#f4f4f4"/>
        <text x="700" y="380" font-family="sans-serif" font-size="96" font-weight="bold" fill="#fafafa">TITEL</text>
      </svg>`),
    )
      .png()
      .toBuffer();
    const report = await runCandidateQa({
      image: washedOut,
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
      mode: 'composite',
    });
    expect(report.checks.find((c) => c.name === 'text_legibility_small')?.passed).toBe(false);
  });

  it('bewertet Lesbarkeit bei 320px, nicht in voller Auflösung', async () => {
    const report = await runCandidateQa({
      image: await composite(),
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
      mode: 'composite',
    });
    expect(report.checks.find((c) => c.name === 'text_legibility_small')?.detail).toMatch(/320px/);
  });

  it('Standardmodus ist Artwork — bestehende Aufrufer bleiben unverändert', async () => {
    const report = await runCandidateQa({
      image: await artwork(),
      targetSize: `${W}x${H}`,
      textArea: 'RIGHT_TEXT',
    });
    expect(report.checks.map((c) => c.name)).toContain('text_safe_area');
  });
});
