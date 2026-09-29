import sharp from 'sharp';

/**
 * Measures the real rendered width of a text run.
 * Guessing character widths is unreliable across fonts, so the text is
 * rasterised once on a transparent canvas and trimmed to its bounding box.
 */
export async function measureTextWidth(text: string, fontSize: number, fontFamily: string): Promise<number> {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const canvasWidth = Math.max(64, Math.ceil(text.length * fontSize * 1.6) + 200);
  const canvasHeight = Math.ceil(fontSize * 2.4) + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <rect width="100%" height="100%" fill="#000"/>
    <text x="20" y="${Math.round(fontSize * 1.4)}" font-family="${fontFamily}" font-size="${fontSize}"
      font-weight="900" fill="#fff">${safe}</text>
  </svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg)).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    // Fallback to a conservative heuristic if trimming fails (e.g. empty text).
    return text.length * fontSize * 0.62;
  }
}

/** Per-character width ratio for the given font, derived from one measurement. */
export async function charWidthRatio(sample: string, fontFamily: string): Promise<number> {
  const probe = sample.trim() || 'THUMBNAIL';
  const width = await measureTextWidth(probe, 100, fontFamily);
  return width / 100 / probe.length;
}
