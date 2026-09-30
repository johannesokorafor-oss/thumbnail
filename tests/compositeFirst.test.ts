import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Regression guard for the architectural defect that was already found once:
 * the pipeline must evaluate the COMPOSED thumbnail (artwork + headline), not
 * the bare artwork. If anyone rewires critique/ranking back to `variant.file`,
 * these tests fail.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-comp-'));
process.env.TEST_MODE = 'true';
process.env.INPUT_FOLDER = path.join(tmp, 'in');
process.env.OUTPUT_FOLDER = path.join(tmp, 'out');
process.env.ARCHIVE_FOLDER = path.join(tmp, 'archive');
process.env.FAILED_FOLDER = path.join(tmp, 'failed');
process.env.REFERENCE_FOLDER = path.join(tmp, 'refs');
process.env.IMAGE_SIZE = '1280x720';
process.env.VARIANT_COUNT = '3';
process.env.MAX_COST_PER_JOB = '1000';
process.env.MAX_COST_PER_DAY = '100000';
delete process.env.MIN_THUMBNAIL_SCORE;

const { registerScript, runPipeline } = await import('../src/pipeline/pipeline.js');
const { ensureWorkspaceFolders } = await import('../src/config/index.js');

let result: Awaited<ReturnType<typeof runPipeline>>;
let outDir: string;

/** Mean absolute difference between two images, 0 = identical. */
async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const norm = (buf: Buffer) =>
    sharp(buf).greyscale().resize(160, 90, { fit: 'fill' }).raw().toBuffer();
  const [x, y] = await Promise.all([norm(a), norm(b)]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

describe('Bewertung am fertigen Gesamtbild', () => {
  beforeAll(async () => {
    ensureWorkspaceFolders();
    const source = path.resolve('data/examples/Alchemie_Das_verbotene_Wissen.md');
    const target = path.join(process.env.INPUT_FOLDER!, 'composite.md');
    fs.writeFileSync(target, `${fs.readFileSync(source, 'utf8')}\n\n<!-- Composite ${Date.now()} -->\n`);
    const { job } = registerScript(target);
    result = await runPipeline(job!.id);
    outDir = result.outputDir!;
  }, 300_000);

  it('erzeugt für jeden Kandidaten ein Gesamtbild, nicht nur das Artwork', () => {
    expect(result.variants?.length).toBeGreaterThan(1);
    for (const v of result.variants ?? []) {
      expect(v.compositeFile, `Variante ${v.index} ohne Gesamtbild`).toBeDefined();
      expect(fs.existsSync(v.compositeFile!)).toBe(true);
    }
  });

  it('das Gesamtbild unterscheidet sich sichtbar vom nackten Artwork', async () => {
    // Wäre die Schrift nicht eingebrannt, wären beide Dateien identisch und
    // die Bewertung liefe faktisch weiter auf dem Artwork.
    const v = result.variants![0];
    const diff = await meanDiff(fs.readFileSync(v.file), fs.readFileSync(v.compositeFile!));
    expect(diff).toBeGreaterThan(1);
  });

  it('prüft das Gesamtbild auf Lesbarkeit statt auf freie Fläche', () => {
    for (const v of result.variants ?? []) {
      const names = (v.compositeQa?.checks ?? []).map((c) => c.name);
      expect(names).toContain('text_legibility_small');
      // Am Gesamtbild wäre die Schrift selbst die "Unruhe" — Fehlalarm.
      expect(names).not.toContain('text_safe_area');
    }
  });

  it('entscheidet die Textplatzierung je Kandidat aus dem Bild heraus', () => {
    for (const v of result.variants ?? []) {
      expect(v.placement?.position).toBeTruthy();
      expect(v.placement?.reason).toBeTruthy();
      expect(typeof v.placement?.backdropForced).toBe('boolean');
    }
  });

  it('legt Sichtprüfungs-Ansichten bei 1280, 640 und 320 an', () => {
    const dir = path.join(outDir, 'INSPECTION');
    for (const w of [1280, 640, 320]) {
      expect(fs.existsSync(path.join(dir, `FINAL_${w}.jpg`)), `FINAL_${w}.jpg fehlt`).toBe(true);
    }
    // auch die unterlegenen Kandidaten müssen begutachtbar sein
    const files = fs.readdirSync(dir);
    expect(files.some((f) => /^VARIANT_\d+_320\.jpg$/.test(f))).toBe(true);
  });

  it('die 320px-Ansicht hat wirklich Feed-Größe', async () => {
    const meta = await sharp(path.join(outDir, 'INSPECTION', 'FINAL_320.jpg')).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(180);
  });

  it('markiert TEST_MODE-Ausgaben als nicht veröffentlichbar', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    expect(meta.publishable).toBe(false);
    expect(meta.artwork_is_placeholder).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'NICHT_VEROEFFENTLICHEN.txt'))).toBe(true);
  });

  it('protokolliert die Platzierung des Endbilds in den Metadaten', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    expect(meta.text_placement?.position).toBeTruthy();
    expect(meta.text_placement?.focal_overlap).not.toBeUndefined();
  });
});
