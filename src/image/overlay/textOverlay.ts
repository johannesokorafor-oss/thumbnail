import sharp from 'sharp';
import type { TextPosition } from '../../types/index.js';
import { analyzeRegion, deriveTextColors, safeAreaRect, type TextColors } from './colorAnalysis.js';
import { charWidthRatio, measureTextWidth } from './measure.js';

export interface OverlayOptions {
  text: string;
  position: TextPosition;
  /** Explicit rectangle from the content-aware placement step. */
  rect?: { left: number; top: number; width: number; height: number };
  /** Hue that is demonstrably unused in the artwork, so the accent stands out. */
  accentHue?: number;
  /** Force the contrast scrim (placement detected an overlap with the subject). */
  forceBackdrop?: boolean;
  font?: string;
  /** Optional fixed colours; otherwise derived from the artwork. */
  colors?: Partial<TextColors>;
  /** Emphasise the last word with the accent colour. */
  accentLastWord?: boolean;
  uppercase?: boolean;
}

export interface OverlayResult {
  image: Buffer;
  lines: string[];
  fontSize: number;
  colors: TextColors;
  rect: { left: number; top: number; width: number; height: number };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Fallback advance width per character for a heavy display face. */
export const CHAR_RATIO = 0.62;

export function wrapText(text: string, maxWidthPx: number, fontSize: number, maxLines = 3, charRatio = CHAR_RATIO): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const charWidth = fontSize * charRatio;
  const maxChars = Math.max(4, Math.floor(maxWidthPx / charWidth));
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    head.push(lines.slice(maxLines - 1).join(' '));
    return head;
  }
  return lines;
}

/** Largest font size where the wrapped text fits the safe area. */
export function fitFontSize(
  text: string,
  rectWidth: number,
  rectHeight: number,
  maxLines = 3,
  charRatio = CHAR_RATIO,
): { fontSize: number; lines: string[] } {
  let best = { fontSize: Math.round(rectHeight * 0.1), lines: wrapText(text, rectWidth, Math.round(rectHeight * 0.1), maxLines, charRatio) };
  for (let size = Math.round(rectHeight * 0.55); size >= Math.max(10, Math.round(rectHeight * 0.06)); size -= 2) {
    const lines = wrapText(text, rectWidth, size, maxLines, charRatio);
    const blockHeight = lines.length * size * 1.12;
    const widest = Math.max(...lines.map((l) => l.length * size * charRatio));
    if (blockHeight <= rectHeight * 0.95 && widest <= rectWidth) {
      return { fontSize: size, lines };
    }
    best = { fontSize: size, lines };
  }
  return best;
}

/**
 * Same as fitFontSize, but verifies the result against the real rendered
 * glyph widths and shrinks the type until it provably fits the safe area.
 */
export async function fitFontSizeMeasured(
  text: string,
  rectWidth: number,
  rectHeight: number,
  fontFamily: string,
  maxLines = 3,
): Promise<{ fontSize: number; lines: string[] }> {
  const ratio = await charWidthRatio(text, fontFamily);
  let { fontSize, lines } = fitFontSize(text, rectWidth, rectHeight, maxLines, ratio);

  for (let i = 0; i < 4; i++) {
    const widths = await Promise.all(lines.map((l) => measureTextWidth(l, fontSize, fontFamily)));
    const widest = Math.max(...widths, 1);
    const blockHeight = lines.length * fontSize * 1.12;
    if (widest <= rectWidth && blockHeight <= rectHeight) break;
    const scale = Math.min(rectWidth / widest, rectHeight / blockHeight) * 0.97;
    const next = Math.max(10, Math.floor(fontSize * scale));
    if (next === fontSize) break;
    fontSize = next;
    lines = wrapText(text, rectWidth, fontSize, maxLines, ratio);
  }
  return { fontSize, lines };
}

/**
 * Programmatic typographic overlay (sections 8/22/23).
 * Perfect spelling, reproducible placement, adaptive colours.
 */
export async function renderTextOverlay(artwork: Buffer, opts: OverlayOptions): Promise<OverlayResult> {
  const meta = await sharp(artwork).metadata();
  const width = meta.width ?? 2560;
  const height = meta.height ?? 1440;
  const rect = opts.rect ?? safeAreaRect(opts.position, width, height);
  const stats = await analyzeRegion(artwork, rect);
  const derived = deriveTextColors(stats, undefined, opts.accentHue);
  const colors: TextColors = {
    ...derived,
    useBackdrop: derived.useBackdrop || opts.forceBackdrop === true,
    ...opts.colors,
  };

  const text = opts.uppercase === false ? opts.text : opts.text.toUpperCase();
  const fontFamily = opts.font ?? 'Inter, "Inter ExtraBold", "Arial Black", "DejaVu Sans", Arial, sans-serif';
  const { fontSize, lines } = await fitFontSizeMeasured(text, rect.width, rect.height, fontFamily, 3);
  const lineHeight = fontSize * 1.1;
  const blockHeight = lines.length * lineHeight;
  const startY = rect.top + (rect.height - blockHeight) / 2 + fontSize * 0.82;
  const centerX = rect.left + rect.width / 2;

  const fontFamilyAttr = escapeXml(fontFamily);
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.055));

  const backdrop = colors.useBackdrop
    ? `<rect x="${rect.left - fontSize * 0.25}" y="${startY - fontSize}" rx="${Math.round(fontSize * 0.12)}"
        width="${rect.width + fontSize * 0.5}" height="${blockHeight + fontSize * 0.5}"
        fill="rgba(0,0,0,0.42)"/>`
    : '';

  const accentIndex = opts.accentLastWord === false ? -1 : lines.length - 1;

  const textEls = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      const fill = i === accentIndex && lines.length > 1 ? colors.accent : colors.fill;
      const safe = escapeXml(line);
      return `<text x="${centerX}" y="${y}" text-anchor="middle" font-family="${fontFamilyAttr}"
        font-size="${fontSize}" font-weight="900" letter-spacing="${(fontSize * 0.005).toFixed(2)}"
        fill="${fill}" stroke="${colors.stroke}" stroke-width="${strokeWidth}" paint-order="stroke"
        stroke-linejoin="round" filter="url(#ds)">${safe}</text>`;
    })
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(fontSize * 0.06)}" stdDeviation="${Math.round(fontSize * 0.05)}" flood-color="${colors.shadow}"/>
    </filter>
  </defs>
  ${backdrop}
  ${textEls}
</svg>`;

  const image = await sharp(artwork)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { image, lines, fontSize, colors, rect };
}
