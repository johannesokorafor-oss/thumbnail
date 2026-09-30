import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The gate must refuse to present a weak candidate as a finished thumbnail.
 * A poor image must not become "best" just because the others are worse.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-gate-'));
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
// Unerreichbar hohe Schwelle: kein Kandidat darf durchkommen.
process.env.MIN_THUMBNAIL_SCORE = '9.9';

const { registerScript, runPipeline } = await import('../src/pipeline/pipeline.js');
const { getConfig, ensureWorkspaceFolders, qualityModeSettings } = await import('../src/config/index.js');

let result: Awaited<ReturnType<typeof runPipeline>>;

describe('Qualitätsschwelle', () => {
  beforeAll(async () => {
    ensureWorkspaceFolders();
    const source = path.resolve('data/examples/Alchemie_Das_verbotene_Wissen.md');
    const target = path.join(process.env.INPUT_FOLDER!, 'gate.md');
    fs.writeFileSync(target, `${fs.readFileSync(source, 'utf8')}\n\n<!-- Gate ${Date.now()} -->\n`);
    const { job } = registerScript(target);
    result = await runPipeline(job!.id);
  }, 180_000);

  it('verwirft den gesamten Satz, statt den am wenigsten schlechten Kandidaten zu liefern', () => {
    expect(result.status).toBe('REJECTED');
    expect(result.error?.code).toBe('ALL_CANDIDATES_REJECTED');
  });

  it('exportiert bewusst KEIN finales Thumbnail', () => {
    expect(result.outputDir).toBeDefined();
    expect(fs.existsSync(path.join(result.outputDir!, 'FINAL_THUMBNAIL.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(result.outputDir!, 'FINAL_THUMBNAIL.png'))).toBe(false);
  });

  it('schreibt einen nachvollziehbaren Ablehnungsbericht mit Hauptschwäche je Kandidat', () => {
    const report = JSON.parse(fs.readFileSync(path.join(result.outputDir!, 'REJECTION_REPORT.json'), 'utf8'));
    expect(report.stage).toBe('quality_gate');
    expect(report.minimum_required_score).toBe(9.9);
    expect(report.candidates.length).toBeGreaterThan(0);
    expect(report.details.join(' ')).toMatch(/Mindestschwelle/);
    for (const c of report.candidates) {
      expect(c.score === null || typeof c.score === 'number').toBe(true);
    }
  });

  it('behält die Kandidatenbilder zur Nachprüfung', () => {
    const files = fs.readdirSync(result.outputDir!);
    expect(files.some((f) => /^VARIANT_\d+\.png$/.test(f))).toBe(true);
  });

  it('Premium-Modi haben eine strengere Schwelle als FAST', () => {
    expect(qualityModeSettings('MAX').minAcceptableScore).toBeGreaterThan(
      qualityModeSettings('FAST').minAcceptableScore,
    );
    expect(qualityModeSettings('BALANCED').minAcceptableScore).toBeGreaterThan(
      qualityModeSettings('FAST').minAcceptableScore,
    );
  });

  it('TEST_MODE darf die Schwelle nicht als Qualitätsurteil benutzen', () => {
    // Ohne expliziten Wert ist die Schwelle im TEST_MODE 0 — Mock-Zahlen sind
    // kein Qualitätsurteil und dürfen weder bestehen noch durchfallen lassen.
    const cfg = getConfig();
    expect(cfg.testMode).toBe(true);
    expect(cfg.minThumbnailScore).toBe(9.9); // hier bewusst gesetzt
  });
});
