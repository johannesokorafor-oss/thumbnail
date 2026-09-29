import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Full technical end-to-end run of the pipeline in TEST_MODE (section 67). */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-e2e-'));
process.env.TEST_MODE = 'true';
process.env.INPUT_FOLDER = path.join(tmp, 'in');
process.env.OUTPUT_FOLDER = path.join(tmp, 'out');
process.env.ARCHIVE_FOLDER = path.join(tmp, 'archive');
process.env.FAILED_FOLDER = path.join(tmp, 'failed');
process.env.REFERENCE_FOLDER = path.join(tmp, 'refs');
process.env.IMAGE_SIZE = '1280x720';
process.env.VARIANT_COUNT = '4';
// Budgetwächter für den Testlauf großzügig setzen: getestet wird die Pipeline,
// nicht das Kostenlimit (der Kostenspeicher ist über Läufe hinweg persistent).
process.env.MAX_COST_PER_JOB = '1000';
process.env.MAX_COST_PER_DAY = '100000';

const { registerScript, runPipeline } = await import('../src/pipeline/pipeline.js');
const { jobManager } = await import('../src/pipeline/jobs/jobManager.js');
const { ensureWorkspaceFolders } = await import('../src/config/index.js');

let outputDir = '';

describe('End-to-End-Pipeline (TEST_MODE)', () => {
  beforeAll(async () => {
    ensureWorkspaceFolders();
    const source = path.resolve('data/examples/Alchemie_Das_verbotene_Wissen.md');
    const target = path.join(process.env.INPUT_FOLDER!, 'Alchemie_Das_verbotene_Wissen.md');
    // Eindeutiger Inhalt pro Testlauf => eigener SHA-256-Hash
    fs.writeFileSync(target, `${fs.readFileSync(source, 'utf8')}\n\n<!-- Testlauf ${Date.now()} -->\n`);

    const { job } = registerScript(target);
    expect(job).toBeDefined();
    const result = await runPipeline(job!.id);
    expect(result.status).toBe('COMPLETED');
    outputDir = result.outputDir!;
  }, 180_000);

  it('legt einen sauber benannten Ausgabeordner an', () => {
    expect(path.basename(outputDir)).toBe('Alchemie_Das_verbotene_Wissen');
  });

  it('erzeugt alle Pflicht-Ausgabedateien', () => {
    for (const f of ['FINAL_THUMBNAIL.jpg', 'FINAL_THUMBNAIL.png', 'CLEAN_ART.png', 'THUMBNAIL_ANALYSIS.json', 'PROMPT_USED.txt', 'MOBILE_PREVIEW.jpg']) {
      expect(fs.existsSync(path.join(outputDir, f)), f).toBe(true);
    }
  });

  it('erzeugt mehrere Varianten', () => {
    const variants = fs.readdirSync(outputDir).filter((f) => /^VARIANT_\d+\.png$/.test(f));
    expect(variants.length).toBeGreaterThanOrEqual(4);
  });

  it('schreibt vollständige Metadaten', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    for (const key of ['source_file', 'processing_timestamp', 'video_title', 'thumbnail_hook', 'thumbnail_text',
      'concept_summary', 'selected_variant', 'selection_reason', 'image_model', 'analysis_model',
      'quality', 'size', 'generation_count', 'iteration_count', 'final_score', 'error_information']) {
      expect(meta, key).toHaveProperty(key);
    }
    expect(meta.cost_is_estimate).toBe(true);
    expect(meta.concepts.length).toBeGreaterThanOrEqual(4);
    expect(meta.thumbnail_text.length).toBeGreaterThan(2);
  });

  it('besteht die technische Qualitätskontrolle', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    const failed = meta.qa.checks.filter((c: { passed: boolean }) => !c.passed);
    expect(failed, JSON.stringify(failed)).toHaveLength(0);
  });

  it('protokolliert Soll- und Ist-Konfiguration transparent', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    for (const key of ['candidates_generated', 'candidates_rejected', 'requested_model', 'requested_quality',
      'requested_size', 'quality_source', 'premium_mode', 'quality_degradations', 'visual_ranking', 'critique_source']) {
      expect(meta, key).toHaveProperty(key);
    }
    expect(meta.requested_size).toMatch(/^\d+x\d+$/);
    expect(meta.candidates_generated).toBeGreaterThanOrEqual(4);
    // TEST_MODE darf niemals als echte Generierung durchgehen:
    expect(meta.test_mode).toBe(true);
    expect(meta.image_model).toBe('mock-image-model');
    expect(meta.quality_degradations.some((d: { kind: string }) => d.kind === 'model')).toBe(true);
    expect(meta.critique_source).toBe('deterministic-mock');
  });

  it('bewertet jeden Kandidaten anhand echter Pixel und begründet die Auswahl', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    for (const v of meta.variants) {
      expect(v.localQa, `Variante ${v.index} ohne lokale QA`).toBeDefined();
      expect(v.localQa.checks.length).toBeGreaterThanOrEqual(10);
      expect(v.localQa.metrics.width).toBeGreaterThan(0);
      expect(v.localQa.hash).toMatch(/^[0-9a-f]+$/);
    }
    // Die Bewertungen dürfen nicht für alle Kandidaten identisch sein.
    const scores = meta.variants.filter((v: { critique?: unknown }) => v.critique).map((v: { critique: { scoreTotal: number } }) => v.critique.scoreTotal);
    expect(scores.length).toBeGreaterThan(0);
    if (scores.length > 1) expect(new Set(scores).size).toBeGreaterThan(1);
    expect(meta.selection_reason.length).toBeGreaterThan(10);
  });

  it('wählt eine Variante, die die lokale Qualitätsprüfung nicht verworfen hat', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), 'utf8'));
    const selected = meta.variants.find((v: { index: number }) => v.index === meta.selected_variant);
    expect(selected).toBeDefined();
    expect(selected.rejected).not.toBe(true);
  });

  it('exportiert eine direkt hochladbare Datei', () => {
    const jpg = path.join(outputDir, 'FINAL_THUMBNAIL.jpg');
    const bytes = fs.statSync(jpg).size;
    expect(bytes).toBeGreaterThan(10_000);
    expect(bytes).toBeLessThan(2 * 1024 * 1024); // YouTube-Limit
  });

  it('archiviert das Quellskript', () => {
    expect(fs.existsSync(path.join(process.env.ARCHIVE_FOLDER!, 'Alchemie_Das_verbotene_Wissen.md'))).toBe(true);
  });

  it('erkennt Duplikate anhand des SHA-256-Hashs', () => {
    const target = path.join(process.env.INPUT_FOLDER!, 'Alchemie_Das_verbotene_Wissen.md');
    const again = registerScript(target);
    expect(again.skipped).toBeDefined();
    expect(again.job).toBeUndefined();
  });

  it('markiert unbrauchbare Eingaben als FAILED, ohne die Pipeline zu beenden', async () => {
    const bad = path.join(process.env.INPUT_FOLDER!, 'kaputt.txt');
    fs.writeFileSync(bad, 'zu kurz');
    const { job } = registerScript(bad);
    const result = await runPipeline(job!.id);
    expect(result.status).toBe('FAILED');
    expect(result.error?.permanent).toBe(true);
    expect(fs.readdirSync(process.env.FAILED_FOLDER!).length).toBeGreaterThan(0);
    expect(jobManager.get(job!.id)?.status).toBe('FAILED');
  }, 60_000);
});
