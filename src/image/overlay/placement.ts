import sharp from 'sharp';
import type { TextPosition } from '../../types/index.js';
import { safeAreaRect, type SafeAreaRect } from './colorAnalysis.js';

/**
 * Content-aware placement of the headline.
 *
 * The art direction proposes a text area, but the generated image decides
 * whether that area is actually usable. Without this step the headline can
 * land straight on the subject's face — the single most common reason a
 * thumbnail looks unfinished.
 *
 * Everything here is measured on the real pixels of the artwork.
 */

export const TEXT_POSITIONS: TextPosition[] = [
  'LEFT_TEXT',
  'RIGHT_TEXT',
  'TOP_TEXT',
  'BOTTOM_TEXT',
  'CENTER_TEXT',
];

export interface FocalRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Share of total edge energy inside the box (0..1). */
  strength: number;
}

export interface PlacementScore {
  position: TextPosition;
  /** Mean gradient magnitude in the area, relative to the whole image (1 = average). */
  busyness: number;
  /** Luminance spread inside the area — high means a restless background. */
  luminanceSpread: number;
  /** Share of the text rectangle covered by the focal region (0..1). */
  focalOverlap: number;
  /** Lower is better. */
  cost: number;
  preferred: boolean;
}

export interface PlacementResult {
  position: TextPosition;
  rect: SafeAreaRect;
  focal: FocalRegion;
  scores: PlacementScore[];
  /** True when the measurement overruled the concept's suggestion. */
  overrodePreference: boolean;
  /** Even the best area still sits on the subject — the scrim becomes mandatory. */
  needsBackdrop: boolean;
  reason: string;
}

const GRID_X = 16;
const GRID_Y = 9;

/** Per-cell gradient magnitude on a downscaled grayscale copy. */
async function energyGrid(image: Buffer): Promise<{ cells: number[][]; total: number }> {
  const w = GRID_X * 16;
  const h = GRID_Y * 16;
  const { data } = await sharp(image)
    .greyscale()
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cells: number[][] = Array.from({ length: GRID_Y }, () => new Array(GRID_X).fill(0));
  let total = 0;
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      const g = Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - w]);
      cells[Math.floor((y / h) * GRID_Y)][Math.floor((x / w) * GRID_X)] += g;
      total += g;
    }
  }
  return { cells, total };
}

/**
 * Bounding box of the dominant detail cluster — a cheap stand-in for
 * "where the subject is". Good enough to keep type off a face.
 */
export async function findFocalRegion(image: Buffer): Promise<FocalRegion> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const { cells, total } = await energyGrid(image);

  const flat = cells.flat();
  const mean = flat.reduce((a, b) => a + b, 0) / Math.max(1, flat.length);
  const sorted = [...flat].sort((a, b) => b - a);
  // Threshold: clearly above average, but always keeps the strongest cells.
  const threshold = Math.max(mean * 1.35, sorted[Math.floor(sorted.length * 0.12)] ?? mean);

  let minX = GRID_X;
  let maxX = -1;
  let minY = GRID_Y;
  let maxY = -1;
  let inside = 0;
  for (let y = 0; y < GRID_Y; y++) {
    for (let x = 0; x < GRID_X; x++) {
      if (cells[y][x] >= threshold) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        inside += cells[y][x];
      }
    }
  }
  if (maxX < 0) {
    // Completely uniform image: treat the centre as the focal area.
    return { left: Math.round(W * 0.3), top: Math.round(H * 0.3), width: Math.round(W * 0.4), height: Math.round(H * 0.4), strength: 0 };
  }
  return {
    left: Math.round((minX / GRID_X) * W),
    top: Math.round((minY / GRID_Y) * H),
    width: Math.round(((maxX - minX + 1) / GRID_X) * W),
    height: Math.round(((maxY - minY + 1) / GRID_Y) * H),
    strength: total > 0 ? Number((inside / total).toFixed(3)) : 0,
  };
}

function overlapRatio(rect: SafeAreaRect, focal: FocalRegion): number {
  const x = Math.max(0, Math.min(rect.left + rect.width, focal.left + focal.width) - Math.max(rect.left, focal.left));
  const y = Math.max(0, Math.min(rect.top + rect.height, focal.top + focal.height) - Math.max(rect.top, focal.top));
  const area = rect.width * rect.height;
  return area > 0 ? Number(((x * y) / area).toFixed(3)) : 0;
}

/**
 * `scale` keeps the sampling density identical for every area. Measuring each
 * rectangle at a fixed pixel width would make wide areas look artificially
 * calm, because they get downscaled more than narrow ones.
 */
async function areaMetrics(
  image: Buffer,
  rect: SafeAreaRect,
  imageEnergy: number,
  scale: number,
): Promise<{ busyness: number; spread: number }> {
  const safe = {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
  const region = sharp(image).extract(safe);
  const buf = await region.clone().toBuffer();
  const stats = await sharp(buf).stats();
  const spread = stats.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;

  const { data, info } = await sharp(buf)
    .greyscale()
    .resize({ width: Math.max(16, Math.round(safe.width * scale)), withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  for (let y = 1; y < info.height; y++) {
    for (let x = 1; x < info.width; x++) {
      const i = y * info.width + x;
      sum += Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - info.width]);
      count++;
    }
  }
  const energy = sum / Math.max(1, count);
  return { busyness: imageEnergy > 0 ? Number((energy / imageEnergy).toFixed(3)) : 1, spread: Number(spread.toFixed(2)) };
}

/** Mean gradient magnitude of the whole image, used as the reference value. */
async function globalEnergy(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image)
    .greyscale()
    .resize({ width: 512, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  for (let y = 1; y < info.height; y++) {
    for (let x = 1; x < info.width; x++) {
      const i = y * info.width + x;
      sum += Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - info.width]);
      count++;
    }
  }
  return sum / Math.max(1, count);
}

const POSITION_LABEL: Record<TextPosition, string> = {
  LEFT_TEXT: 'linke Bildhälfte',
  RIGHT_TEXT: 'rechte Bildhälfte',
  TOP_TEXT: 'oberer Bildbereich',
  BOTTOM_TEXT: 'unterer Bildbereich',
  CENTER_TEXT: 'Bildmitte',
};

/**
 * Pick the text area by measuring the artwork.
 *
 * The concept's suggestion gets a bonus, but it loses when the measurement
 * shows the headline would sit on the subject or in a restless area.
 */
export async function choosePlacement(
  artwork: Buffer,
  preferred: TextPosition,
  opts: { allowOverride?: boolean } = {},
): Promise<PlacementResult> {
  const meta = await sharp(artwork).metadata();
  const width = meta.width ?? 2560;
  const height = meta.height ?? 1440;
  const focal = await findFocalRegion(artwork);
  const imageEnergy = await globalEnergy(artwork);
  // Same sampling density as globalEnergy (which resizes the image to 512 px).
  const scale = Math.min(1, 512 / width);

  const scores: PlacementScore[] = [];
  for (const position of TEXT_POSITIONS) {
    const rect = safeAreaRect(position, width, height);
    const { busyness, spread } = await areaMetrics(artwork, rect, imageEnergy, scale);
    const focalOverlap = overlapRatio(rect, focal);
    const isPreferred = position === preferred;

    // Overlap with the subject dominates the cost: type on the subject is the
    // defect we are actually trying to prevent.
    const cost =
      focalOverlap * 3.2 +
      Math.max(0, busyness - 0.6) * 1.4 +
      Math.min(spread / 90, 1) * 0.6 +
      (position === 'CENTER_TEXT' ? 0.35 : 0) + // centre covers the subject in most layouts
      (isPreferred ? -0.25 : 0);

    scores.push({
      position,
      busyness,
      luminanceSpread: spread,
      focalOverlap,
      cost: Number(cost.toFixed(3)),
      preferred: isPreferred,
    });
  }

  scores.sort((a, b) => a.cost - b.cost);
  const allowOverride = opts.allowOverride !== false;
  const best = allowOverride ? scores[0] : scores.find((s) => s.preferred) ?? scores[0];
  const preferredScore = scores.find((s) => s.preferred)!;
  const overrodePreference = best.position !== preferred;

  const rect = safeAreaRect(best.position, width, height);
  // Force the scrim when we cannot guarantee a clean area: the type still sits
  // on the subject, the area is busy, or the image has no distinguishable
  // subject at all (uniformly detailed images have no calm spot).
  const needsBackdrop =
    best.focalOverlap > 0.12 || best.busyness > 0.9 || best.luminanceSpread > 58 || focal.strength === 0;

  const reason = overrodePreference
    ? `Textfläche von "${preferred}" auf "${best.position}" korrigiert (${POSITION_LABEL[best.position]}): ` +
      `dort überlagert die Schrift das Hauptmotiv zu ${(best.focalOverlap * 100).toFixed(0)}% statt zu ` +
      `${(preferredScore.focalOverlap * 100).toFixed(0)}% und der Bereich ist ruhiger ` +
      `(Detaildichte ${best.busyness.toFixed(2)} statt ${preferredScore.busyness.toFixed(2)}).`
    : `Textfläche "${best.position}" (${POSITION_LABEL[best.position]}) durch Messung bestätigt: ` +
      `Überlappung mit dem Hauptmotiv ${(best.focalOverlap * 100).toFixed(0)}%, Detaildichte ${best.busyness.toFixed(2)}.`;

  return { position: best.position, rect, focal, scores, overrodePreference, needsBackdrop, reason };
}
