import sharp from 'sharp';
import type { Metadata } from 'sharp';
import type { QaCheck, QaReport } from '../../types/index.js';
import { parseSize } from '../processing/normalize.js';
import { safeAreaRect } from '../overlay/colorAnalysis.js';
import type { TextPosition } from '../../types/index.js';

export interface QaInput {
  finalImage: Buffer;
  cleanArt: Buffer;
  targetSize: string;
  expectText: boolean;
  textPosition: TextPosition;
  mobilePreviewPath?: string;
}

/** Deterministic, local quality assurance (section 40). */
export async function runQualityAssurance(input: QaInput): Promise<QaReport> {
  const checks: QaCheck[] = [];
  const target = parseSize(input.targetSize);

  let meta: Metadata;
  try {
    meta = await sharp(input.finalImage).metadata();
    checks.push({ name: 'file_readable', passed: true, detail: `Bild lesbar (${meta.format}).` });
  } catch (err) {
    return {
      passed: false,
      checks: [{ name: 'file_readable', passed: false, detail: `Bild nicht lesbar: ${(err as Error).message}` }],
    };
  }

  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const ratio = w && h ? w / h : 0;
  checks.push({
    name: 'aspect_16_9',
    passed: Math.abs(ratio - 16 / 9) < 0.01,
    detail: `Seitenverhältnis ${ratio.toFixed(3)} (Soll 1.778).`,
  });
  checks.push({
    name: 'resolution',
    passed: w === target.width && h === target.height,
    detail: `${w}x${h} (Soll ${target.width}x${target.height}).`,
  });

  const stats = await sharp(input.finalImage).stats();
  const meanAll = stats.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
  const stdAll = stats.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
  checks.push({
    name: 'not_blank',
    passed: stdAll > 8,
    detail: `Globale Kontrast-Streuung ${stdAll.toFixed(1)} (leere Fläche wäre ~0).`,
  });
  checks.push({
    name: 'contrast',
    passed: stdAll > 24,
    detail: `Kontrast ${stdAll.toFixed(1)}, mittlere Helligkeit ${meanAll.toFixed(1)}.`,
  });

  // Corner emptiness — detects large dead areas.
  const cw = Math.max(8, Math.round(w * 0.12));
  const ch = Math.max(8, Math.round(h * 0.12));
  const corners = [
    { left: 0, top: 0 },
    { left: w - cw, top: 0 },
    { left: 0, top: h - ch },
    { left: w - cw, top: h - ch },
  ];
  let emptyCorners = 0;
  for (const c of corners) {
    const s = await sharp(input.finalImage).extract({ left: c.left, top: c.top, width: cw, height: ch }).stats();
    const sd = s.channels.slice(0, 3).reduce((a, x) => a + x.stdev, 0) / 3;
    if (sd < 2) emptyCorners++;
  }
  checks.push({
    name: 'no_dead_areas',
    passed: emptyCorners < 3,
    detail: `${emptyCorners}/4 Ecken vollkommen flach.`,
  });

  // Text presence: compare the safe area of final vs clean art.
  if (input.expectText) {
    const rect = safeAreaRect(input.textPosition, w, h);
    const [finalRegion, cleanRegion] = await Promise.all([
      sharp(input.finalImage).extract(rect).greyscale().raw().toBuffer(),
      sharp(input.cleanArt)
        .resize(w, h, { fit: 'cover' })
        .extract(rect)
        .greyscale()
        .raw()
        .toBuffer(),
    ]);
    let diff = 0;
    for (let i = 0; i < finalRegion.length; i++) diff += Math.abs(finalRegion[i] - cleanRegion[i]);
    const avgDiff = diff / finalRegion.length;
    checks.push({
      name: 'text_present',
      passed: avgDiff > 3,
      detail: `Durchschnittliche Abweichung im Textbereich: ${avgDiff.toFixed(2)}.`,
    });

    const textStats = await sharp(input.finalImage).extract(rect).stats();
    const textStd = textStats.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    checks.push({
      name: 'text_contrast',
      passed: textStd > 30,
      detail: `Kontrast im Textbereich: ${textStd.toFixed(1)}.`,
    });
  }

  // Subject prominence heuristic: the busiest third should carry clearly more detail.
  const thirds = await Promise.all(
    [0, 1, 2].map(async (i) => {
      const s = await sharp(input.finalImage)
        .extract({ left: Math.round((w / 3) * i), top: 0, width: Math.round(w / 3), height: h })
        .stats();
      return s.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    }),
  );
  const maxThird = Math.max(...thirds);
  checks.push({
    name: 'subject_prominence',
    passed: maxThird > 20,
    detail: `Detaildichte pro Drittel: ${thirds.map((t) => t.toFixed(0)).join(' / ')}.`,
  });

  const passed = checks.every((c) => c.passed);
  return { passed, checks, mobilePreview: input.mobilePreviewPath };
}
