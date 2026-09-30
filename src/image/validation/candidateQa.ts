import sharp from 'sharp';
import type { Region } from 'sharp';
import type { CandidateQaReport, QaCheck, TextPosition } from '../../types/index.js';
import { safeAreaRect } from '../overlay/colorAnalysis.js';
import { isSixteenNine, parseSize, type Size } from '../size.js';

/** Preview widths a viewer realistically sees in the YouTube feed. */
export const PREVIEW_WIDTHS = [1280, 640, 320];

/**
 * Mean absolute gradient magnitude = how much *visible structure* an area has.
 *
 * Computed from raw grayscale pixels rather than sharp's convolve, because
 * convolve clamps negative responses to 0 on 8-bit data and would report
 * zero energy for smooth images.
 */
async function edgeEnergy(image: Buffer, region?: Region): Promise<number> {
  const pipeline = region ? sharp(image).extract(region) : sharp(image);
  const { data, info } = await pipeline
    .greyscale()
    .resize({ width: Math.min(512, region?.width ?? 512), withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  if (w < 2 || h < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      sum += Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - w]);
      count++;
    }
  }
  return sum / Math.max(1, count);
}

async function contrastOf(image: Buffer, region?: Region): Promise<{ std: number; mean: number }> {
  const pipeline = region ? sharp(image).extract(region) : sharp(image);
  const stats = await pipeline.stats();
  const ch = stats.channels.slice(0, 3);
  return {
    std: ch.reduce((a, c) => a + c.stdev, 0) / ch.length,
    mean: ch.reduce((a, c) => a + c.mean, 0) / ch.length,
  };
}

/** 16x16 average-hash used to detect near-duplicate candidates. */
export async function perceptualHash(image: Buffer): Promise<string> {
  const size = 16;
  const { data } = await sharp(image).greyscale().resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  let bits = '';
  for (let i = 0; i < data.length; i++) bits += data[i] >= mean ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    d += ((x >> 3) & 1) + ((x >> 2) & 1) + ((x >> 1) & 1) + (x & 1);
  }
  return d;
}

export interface CandidateQaOptions {
  image: Buffer;
  targetSize: string;
  textArea: TextPosition;
  /** Reject rather than warn (Stage 1 gate). */
  strict?: boolean;
  /**
   * 'artwork'  — bare generated image: the text area must still be free.
   * 'composite'— artwork plus headline: the text is SUPPOSED to be the detail
   *              in that area, so the free-area check is replaced by a
   *              legibility check (contrast of the type against its backdrop).
   */
  mode?: 'artwork' | 'composite';
}

/**
 * Stage 1 — deterministic local QA for ONE candidate.
 *
 * Everything here is measured on real pixels, including the reduced previews
 * a viewer actually sees. Candidates that collapse at 320px are rejected before
 * any expensive AI critique happens.
 */
export async function runCandidateQa(opts: CandidateQaOptions): Promise<CandidateQaReport> {
  const checks: QaCheck[] = [];
  const target: Size = parseSize(opts.targetSize);
  const meta = await sharp(opts.image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  checks.push({
    name: 'image_integrity',
    passed: Boolean(width && height && meta.format),
    detail: `${meta.format ?? 'unbekannt'} ${width}x${height}`,
  });

  const aspect = width && height ? width / height : 0;
  checks.push({
    name: 'aspect_16_9',
    passed: isSixteenNine({ width, height }, 0.01),
    detail: `Seitenverhältnis ${aspect.toFixed(3)} (Soll 1.778).`,
  });
  checks.push({
    name: 'resolution',
    passed: width >= target.width * 0.95 && height >= target.height * 0.95,
    detail: `${width}x${height} gegen Ziel ${target.width}x${target.height}.`,
  });

  const global = await contrastOf(opts.image);
  checks.push({
    name: 'global_contrast',
    passed: global.std >= 32,
    detail: `Kontrast ${global.std.toFixed(1)} (Minimum 32), mittlere Helligkeit ${global.mean.toFixed(1)}.`,
  });
  checks.push({
    name: 'exposure',
    passed: global.mean > 18 && global.mean < 238,
    detail: `Mittlere Helligkeit ${global.mean.toFixed(1)} (weder abgesoffen noch ausgebrannt).`,
  });

  // --- Text area ------------------------------------------------------------
  const mode = opts.mode ?? 'artwork';
  const rect = safeAreaRect(opts.textArea, width, height);
  const safeEnergy = await edgeEnergy(opts.image, rect);
  const fullEnergy = await edgeEnergy(opts.image);
  const busyness = fullEnergy > 0 ? safeEnergy / fullEnergy : 1;
  if (mode === 'artwork') {
    checks.push({
      name: 'text_safe_area',
      passed: busyness <= 1.05,
      detail: `Detaildichte im Textbereich ${busyness.toFixed(2)}x des Bildmittels (Grenze 1.05).`,
    });
  } else {
    // Measured at 320px width: if the headline still separates from its
    // background there, it is legible in a feed.
    const small = await sharp(opts.image)
      .resize(320, 180, { fit: 'cover' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sx = Math.floor((rect.left / width) * small.info.width);
    const sy = Math.floor((rect.top / height) * small.info.height);
    const sw = Math.max(1, Math.floor((rect.width / width) * small.info.width));
    const sh = Math.max(1, Math.floor((rect.height / height) * small.info.height));
    const values: number[] = [];
    for (let y = sy; y < Math.min(sy + sh, small.info.height); y++) {
      for (let x = sx; x < Math.min(sx + sw, small.info.width); x++) {
        values.push(small.data[y * small.info.width + x]);
      }
    }
    values.sort((a, b) => a - b);
    const lo = values[Math.floor(values.length * 0.05)] ?? 0;
    const hi = values[Math.floor(values.length * 0.95)] ?? 255;
    const contrast = hi - lo;
    checks.push({
      name: 'text_legibility_small',
      passed: contrast >= 60,
      detail: `Kontrastumfang der Textzone bei 320px: ${contrast} Stufen (Minimum 60).`,
    });
  }

  // --- Subject separation: detail must concentrate somewhere ----------------
  const cols = 3;
  const rows = 2;
  const cellEnergies: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cellEnergies.push(
        await edgeEnergy(opts.image, {
          left: Math.floor((width / cols) * c),
          top: Math.floor((height / rows) * r),
          width: Math.floor(width / cols),
          height: Math.floor(height / rows),
        }),
      );
    }
  }
  const maxCell = Math.max(...cellEnergies);
  const avgCell = cellEnergies.reduce((a, b) => a + b, 0) / cellEnergies.length;
  const separation = avgCell > 0 ? maxCell / avgCell : 0;
  checks.push({
    name: 'subject_separation',
    passed: separation >= 1.25,
    detail: `Stärkste Bildzone hat ${separation.toFixed(2)}x die mittlere Detaildichte (Minimum 1.25).`,
  });

  // --- Clutter: too many high-detail cells = no clear hierarchy -------------
  const busyCells = cellEnergies.filter((e) => e > avgCell * 1.15).length;
  checks.push({
    name: 'clutter',
    passed: busyCells <= 3,
    detail: `${busyCells}/6 Bildzonen überdurchschnittlich detailreich (Grenze 3).`,
  });

  // --- Small-size survival --------------------------------------------------
  const smallStats: string[] = [];
  let retention = 1;
  for (const w of PREVIEW_WIDTHS) {
    const preview = await sharp(opts.image).resize(w).jpeg({ quality: 82 }).toBuffer();
    const previewContrast = await contrastOf(preview);
    smallStats.push(`${w}px: Kontrast ${previewContrast.std.toFixed(0)}`);
    if (w === 320) retention = global.std > 0 ? previewContrast.std / global.std : 0;
  }
  checks.push({
    name: 'small_size_contrast',
    passed: retention >= 0.7,
    detail: `Kontrasterhalt bei 320px: ${(retention * 100).toFixed(0)}% (Minimum 70%). ${smallStats.join(', ')}.`,
  });

  const small = await sharp(opts.image).resize(320).jpeg({ quality: 82 }).toBuffer();
  const smallMeta = await sharp(small).metadata();
  const smallSeparationCells: number[] = [];
  for (let c = 0; c < 3; c++) {
    smallSeparationCells.push(
      await edgeEnergy(small, {
        left: Math.floor(((smallMeta.width ?? 320) / 3) * c),
        top: 0,
        width: Math.floor((smallMeta.width ?? 320) / 3),
        height: smallMeta.height ?? 180,
      }),
    );
  }
  const smallAvg = smallSeparationCells.reduce((a, b) => a + b, 0) / smallSeparationCells.length;
  const smallSeparation = smallAvg > 0 ? Math.max(...smallSeparationCells) / smallAvg : 0;
  checks.push({
    name: 'small_size_focus',
    passed: smallSeparation >= 1.15,
    detail: `Fokus bleibt bei 320px erkennbar (${smallSeparation.toFixed(2)}x, Minimum 1.15).`,
  });

  // --- Border artifacts (accidental frames / letterboxing) ------------------
  const borderThickness = Math.max(4, Math.round(height * 0.012));
  const borders = await Promise.all([
    contrastOf(opts.image, { left: 0, top: 0, width, height: borderThickness }),
    contrastOf(opts.image, { left: 0, top: height - borderThickness, width, height: borderThickness }),
    contrastOf(opts.image, { left: 0, top: 0, width: borderThickness, height }),
    contrastOf(opts.image, { left: width - borderThickness, top: 0, width: borderThickness, height }),
  ]);
  const flatBorders = borders.filter((b) => b.std < 1.5).length;
  checks.push({
    name: 'no_border_artifact',
    passed: flatBorders < 2,
    detail: `${flatBorders}/4 Bildkanten vollkommen flach (Hinweis auf Rahmen oder Letterboxing).`,
  });

  const hash = await perceptualHash(opts.image);
  const passed = checks.every((c) => c.passed);

  return {
    passed,
    checks,
    metrics: {
      width,
      height,
      aspect: Number(aspect.toFixed(4)),
      globalContrast: Number(global.std.toFixed(2)),
      safeAreaBusyness: Number(busyness.toFixed(3)),
      subjectSeparation: Number(separation.toFixed(3)),
      clutter: busyCells,
      smallSizeDetailRetention: Number(retention.toFixed(3)),
      borderArtifact: flatBorders,
      meanLuminance: Number(global.mean.toFixed(2)),
    },
    hash,
  };
}

/** Flags candidates that are visually near-identical to a stronger one. */
export function findNearDuplicates(
  candidates: Array<{ index: number; hash: string; score: number }>,
  threshold = 18,
): Array<{ index: number; duplicateOf: number; distance: number }> {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: typeof sorted = [];
  const dupes: Array<{ index: number; duplicateOf: number; distance: number }> = [];
  for (const c of sorted) {
    const clash = kept.find((k) => hammingDistance(k.hash, c.hash) < threshold);
    if (clash) dupes.push({ index: c.index, duplicateOf: clash.index, distance: hammingDistance(clash.hash, c.hash) });
    else kept.push(c);
  }
  return dupes;
}
