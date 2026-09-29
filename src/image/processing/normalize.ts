import sharp from 'sharp';

export interface Size {
  width: number;
  height: number;
}

export function parseSize(size: string, fallback: Size = { width: 2560, height: 1440 }): Size {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(size.trim());
  if (!m) return fallback;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Bring provider output to the exact target resolution and 16:9 aspect.
 * Uses a cover crop so nothing is letterboxed, then a high-quality resize.
 */
export async function normalizeToTarget(input: Buffer, target: Size): Promise<Buffer> {
  return sharp(input)
    .resize(target.width, target.height, { fit: 'cover', position: 'attention', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function toJpeg(input: Buffer, quality = 92): Promise<Buffer> {
  return sharp(input).jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
}

export async function makeMobilePreview(input: Buffer, width = 320): Promise<Buffer> {
  return sharp(input).resize(width).jpeg({ quality: 80 }).toBuffer();
}
