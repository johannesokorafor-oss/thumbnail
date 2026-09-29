/**
 * Size handling for the GPT Image 2.5 family.
 *
 * Constraints taken from the current OpenAI image documentation:
 *  - custom sizes are "WIDTHxHEIGHT"
 *  - both edges must be multiples of 16
 *  - no edge may exceed 3840 px
 *  - longer:shorter edge ratio must not exceed 3:1
 *  - total pixels must be between 655_360 and 8_294_400
 *  - outputs above 3_686_400 px (2560x1440) are documented as experimental
 */

export interface Size {
  width: number;
  height: number;
}

export const MIN_PIXELS = 655_360;
export const MAX_PIXELS = 8_294_400;
export const EXPERIMENTAL_PIXELS = 3_686_400;
export const MAX_EDGE = 3840;
export const EDGE_MULTIPLE = 16;

export function parseSize(size: string, fallback: Size = { width: 2560, height: 1440 }): Size {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(size ?? '').trim());
  if (!m) return fallback;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
  return { width, height };
}

export function formatSize(size: Size): string {
  return `${size.width}x${size.height}`;
}

export function pixelCount(size: Size): number {
  return size.width * size.height;
}

export function aspectRatio(size: Size): number {
  return size.width / size.height;
}

export function isSixteenNine(size: Size, tolerance = 0.005): boolean {
  return Math.abs(aspectRatio(size) - 16 / 9) <= tolerance;
}

export interface SizeValidation {
  valid: boolean;
  problems: string[];
  experimental: boolean;
}

/** Pure check against the documented API constraints. */
export function validateApiSize(size: Size): SizeValidation {
  const problems: string[] = [];
  if (size.width % EDGE_MULTIPLE !== 0 || size.height % EDGE_MULTIPLE !== 0) {
    problems.push(`Kanten müssen Vielfache von ${EDGE_MULTIPLE} sein (${size.width}x${size.height}).`);
  }
  if (size.width > MAX_EDGE || size.height > MAX_EDGE) {
    problems.push(`Keine Kante darf ${MAX_EDGE}px überschreiten.`);
  }
  const ratio = Math.max(aspectRatio(size), 1 / aspectRatio(size));
  if (ratio > 3) problems.push('Seitenverhältnis darf 3:1 nicht überschreiten.');
  const px = pixelCount(size);
  if (px < MIN_PIXELS) problems.push(`Zu wenige Pixel (${px} < ${MIN_PIXELS}).`);
  if (px > MAX_PIXELS) problems.push(`Zu viele Pixel (${px} > ${MAX_PIXELS}).`);
  return { valid: problems.length === 0, problems, experimental: px > EXPERIMENTAL_PIXELS };
}

/** Snap an arbitrary size to the nearest API-legal size with the same aspect ratio. */
export function snapToApiSize(size: Size): Size {
  const ratio = aspectRatio(size);
  const round16 = (v: number) => Math.max(EDGE_MULTIPLE, Math.round(v / EDGE_MULTIPLE) * EDGE_MULTIPLE);

  let width = round16(Math.min(size.width, MAX_EDGE));
  let height = round16(Math.min(size.height, MAX_EDGE));

  // Keep the aspect ratio while pulling the pixel count into the allowed window.
  const scaleInto = (target: number) => {
    const factor = Math.sqrt(target / (width * height));
    width = round16(width * factor);
    height = round16(height * factor);
  };
  if (width * height > MAX_PIXELS) scaleInto(MAX_PIXELS * 0.98);
  if (width * height < MIN_PIXELS) scaleInto(MIN_PIXELS * 1.02);

  // Re-derive the short edge from the ratio so 16:9 stays 16:9 after rounding.
  if (ratio >= 1) height = round16(width / ratio);
  else width = round16(height * ratio);

  if (width * height < MIN_PIXELS) {
    // Rounding pushed us below the floor — step up one notch on both edges.
    width += EDGE_MULTIPLE;
    height = round16(width / ratio);
  }
  return { width, height };
}

/**
 * 16:9 sizes that the API accepts, largest first.
 * Every entry is a multiple of 16 on both edges and inside the pixel window.
 */
export const SIXTEEN_NINE_LADDER: Size[] = [
  { width: 3840, height: 2160 }, // 4K landscape (8_294_400 px, at the documented ceiling)
  { width: 2560, height: 1440 }, // documented threshold for "experimental"
  { width: 2048, height: 1152 }, // common 2K landscape
  { width: 1792, height: 1008 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },  // kleinste 16:9-Größe über der Mindestpixelzahl
];

/**
 * Build the size fallback chain for a request.
 * Every entry keeps 16:9 so a downgrade can never force a crop later on.
 */
export function sixteenNineFallbackChain(requested: Size): Size[] {
  const chain: Size[] = [];
  const push = (s: Size) => {
    if (!chain.some((c) => c.width === s.width && c.height === s.height)) chain.push(s);
  };

  const snapped = snapToApiSize(requested);
  if (validateApiSize(snapped).valid && isSixteenNine(snapped)) push(snapped);

  // Then progressively smaller documented 16:9 sizes.
  for (const size of SIXTEEN_NINE_LADDER) {
    if (pixelCount(size) <= pixelCount(snapped) && validateApiSize(size).valid) push(size);
  }
  if (!chain.length) push({ width: 1536, height: 864 });
  return chain;
}

/**
 * The size actually sent to the API for a requested target.
 * Returns the request plus a note when the target had to be adjusted.
 */
export function resolveRequestSize(requested: Size): { size: Size; note?: string } {
  const validation = validateApiSize(requested);
  if (validation.valid && isSixteenNine(requested)) {
    return { size: requested };
  }
  const snapped = snapToApiSize(requested);
  const snappedValidation = validateApiSize(snapped);
  if (snappedValidation.valid) {
    return {
      size: snapped,
      note: `Zielgröße ${formatSize(requested)} war nicht API-konform (${validation.problems.join(' ')}) – angefragt wird ${formatSize(snapped)}.`,
    };
  }
  const fallback = SIXTEEN_NINE_LADDER.find((s) => validateApiSize(s).valid)!;
  return {
    size: fallback,
    note: `Zielgröße ${formatSize(requested)} ist nicht API-konform – angefragt wird ${formatSize(fallback)}.`,
  };
}
