import sharp from 'sharp';
import type { TextPosition } from '../../types/index.js';

export interface RegionStats {
  meanLuminance: number; // 0..255
  stdLuminance: number;
  dominant: { r: number; g: number; b: number };
  isDark: boolean;
  busy: boolean;
}

export interface SafeAreaRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pixel rectangle reserved for the headline, derived from the concept's text area. */
export function safeAreaRect(position: TextPosition, width: number, height: number): SafeAreaRect {
  const m = Math.round(width * 0.04);
  switch (position) {
    case 'LEFT_TEXT':
      return { left: m, top: Math.round(height * 0.18), width: Math.round(width * 0.42), height: Math.round(height * 0.64) };
    case 'RIGHT_TEXT':
      return { left: Math.round(width * 0.54), top: Math.round(height * 0.18), width: Math.round(width * 0.42), height: Math.round(height * 0.64) };
    case 'TOP_TEXT':
      return { left: m, top: Math.round(height * 0.05), width: width - 2 * m, height: Math.round(height * 0.28) };
    case 'BOTTOM_TEXT':
      return { left: m, top: Math.round(height * 0.66), width: width - 2 * m, height: Math.round(height * 0.29) };
    case 'CENTER_TEXT':
    default:
      return { left: m, top: Math.round(height * 0.36), width: width - 2 * m, height: Math.round(height * 0.28) };
  }
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Analyse the safe area so the text colour can adapt to the artwork (section 23). */
export async function analyzeRegion(image: Buffer, rect: SafeAreaRect): Promise<RegionStats> {
  const region = sharp(image).extract({
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  });
  const stats = await region.stats();
  const [r, g, b] = stats.channels;
  const mean = luminance(r.mean, g.mean, b.mean);
  const std = (r.stdev + g.stdev + b.stdev) / 3;
  const dom = stats.dominant ?? { r: Math.round(r.mean), g: Math.round(g.mean), b: Math.round(b.mean) };
  return {
    meanLuminance: Number(mean.toFixed(2)),
    stdLuminance: Number(std.toFixed(2)),
    dominant: dom,
    isDark: mean < 118,
    busy: std > 58,
  };
}

export interface TextColors {
  fill: string;
  stroke: string;
  shadow: string;
  accent: string;
  useBackdrop: boolean;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

/**
 * Pick text colours from the artwork while keeping a consistent channel look:
 * the body copy stays in the channel's high-contrast base, only the accent adapts.
 */
export function deriveTextColors(stats: RegionStats, channelAccent?: string): TextColors {
  const [h] = rgbToHsl(stats.dominant.r, stats.dominant.g, stats.dominant.b);
  // Complementary-ish accent hue, pushed to a saturated, readable range.
  const accentHue = Math.round((h + 190) % 360);
  const accent = channelAccent ?? `hsl(${accentHue}, 92%, ${stats.isDark ? 62 : 44}%)`;
  if (stats.isDark) {
    return { fill: '#FFFFFF', stroke: 'rgba(0,0,0,0.85)', shadow: 'rgba(0,0,0,0.75)', accent, useBackdrop: stats.busy };
  }
  return { fill: '#0B0B0D', stroke: 'rgba(255,255,255,0.9)', shadow: 'rgba(0,0,0,0.35)', accent, useBackdrop: true };
}
