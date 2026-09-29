/**
 * Benchmark über mehrere Genres.
 *
 * Misst ausschließlich, was tatsächlich passiert ist: Generierungserfolg,
 * verworfene Kandidaten, lokale QA, Kritikergebnisse, Auswahl, Laufzeit,
 * geschätzte Kosten sowie das real verwendete Modell/Qualität/Größe.
 *
 * Es wird KEINE "Verbesserung in Prozent" berechnet — dafür gäbe es keine
 * experimentelle Grundlage.
 *
 *   npm run benchmark                 # nutzt die aktuelle Konfiguration
 *   TEST_MODE=true npm run benchmark  # technischer Durchlauf ohne API-Kosten
 *   npm run benchmark -- --only Mystery
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspaceFolders, getConfig, qualityModeSettings, resolveRequestedQuality } from '../src/config/index.js';
import { orchestrator } from '../src/pipeline/orchestrator.js';
import { jobManager } from '../src/pipeline/jobs/jobManager.js';
import type { Job } from '../src/types/index.js';

const FIXTURES: Array<{ genre: string; file: string }> = [
  { genre: 'Emotionale Menschengeschichte', file: 'Der_Brief_den_sie_nie_abschickte.md' },
  { genre: 'Mystery', file: 'Das_Verschwinden_von_Flug_MH_Sierra.md' },
  { genre: 'Historisch', file: 'Die_Nacht_in_der_Rom_brannte.md' },
  { genre: 'Dramatisches Ereignis', file: '47_Sekunden_bis_zum_Einsturz.md' },
  { genre: 'Dokumentation', file: 'Die_Vermessung_des_Ozeanbodens.md' },
  { genre: 'Bildung', file: 'Warum_Zinseszins_alles_verzerrt.md' },
  { genre: 'Dunkel / Ernst', file: 'Das_Experiment_das_niemand_stoppte.md' },
  { genre: 'Inspirierend', file: 'Sie_lernte_mit_62_lesen.md' },
];

interface Row {
  genre: string;
  file: string;
  status: string;
  durationMs: number;
  candidates: number;
  rejected: number;
  localQaPassed: number;
  critiqueScores: number[];
  critiqueSource: string;
  selected: number | null;
  selectionSource: string;
  qaPassed: boolean | null;
  qaFailures: string[];
  model: string;
  quality: string;
  size: string;
  degradations: number;
  estimatedCostUsd: number;
  error?: string;
}

function summarize(job: Job, genre: string, file: string, durationMs: number): Row {
  const variants = job.variants ?? [];
  return {
    genre,
    file,
    status: job.status,
    durationMs,
    candidates: variants.length,
    rejected: job.rejectedCount ?? variants.filter((v) => v.rejected).length,
    localQaPassed: variants.filter((v) => v.localQa?.passed).length,
    critiqueScores: variants.filter((v) => v.critique).map((v) => Number(v.critique!.scoreTotal.toFixed(2))),
    critiqueSource: variants.find((v) => v.critique)?.critique?.source ?? 'keine',
    selected: job.selectedVariant ?? null,
    selectionSource: job.ranking?.source ?? 'fallback-score',
    qaPassed: job.qa?.passed ?? null,
    qaFailures: (job.qa?.checks ?? []).filter((c) => !c.passed).map((c) => c.name),
    model: job.generation?.actualModel ?? '—',
    quality: job.generation?.actualQuality ?? '—',
    size: job.generation?.actualSize ?? '—',
    degradations: job.generation?.degradations.length ?? 0,
    estimatedCostUsd: job.estimatedCostUsd ?? 0,
    error: job.error?.message,
  };
}

async function runOne(genre: string, file: string): Promise<Row> {
  const cfg = getConfig();
  const source = path.resolve('data/examples', file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(cfg.inputFolder, `BENCH_${stamp}_${file}`);
  fs.writeFileSync(target, `${fs.readFileSync(source, 'utf8')}\n\n<!-- Benchmark ${stamp} -->\n`);

  const startedAt = Date.now();
  const jobId = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 1_800_000);
    const onJob = (job: Job) => {
      if (job.sourceFile === target && ['COMPLETED', 'FAILED', 'WAITING'].includes(job.status)) {
        clearTimeout(timeout);
        jobManager.off('job', onJob);
        resolve(job.id);
      }
    };
    jobManager.on('job', onJob);
  });
  return summarize(jobManager.get(jobId)!, genre, file, Date.now() - startedAt);
}

async function main() {
  const cfg = getConfig();
  ensureWorkspaceFolders(cfg);
  const mode = qualityModeSettings(cfg.qualityMode);
  const requested = resolveRequestedQuality(cfg);
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
  const fixtures = only ? FIXTURES.filter((f) => f.genre.toLowerCase().includes(only.toLowerCase())) : FIXTURES;

  console.log('================= BENCHMARK =================');
  console.log(`TEST_MODE:        ${cfg.testMode}${cfg.testMode ? '  (synthetische Bilder – KEIN Nachweis echter Bildqualität)' : ''}`);
  console.log(`Qualitätsmodus:   ${cfg.qualityMode}`);
  console.log(`Angefragt:        ${cfg.imageModel} / ${requested.quality} (${requested.source}) / ${cfg.resolution}`);
  console.log(`Kandidaten:       ${mode.variants} pro Skript, Verfeinerungen ${mode.refinementPasses}`);
  console.log(`Skripte:          ${fixtures.length}`);
  console.log('=============================================\n');

  await orchestrator.start();
  const rows: Row[] = [];
  for (const f of fixtures) {
    process.stdout.write(`▶ ${f.genre} … `);
    try {
      const row = await runOne(f.genre, f.file);
      rows.push(row);
      console.log(`${row.status} (${(row.durationMs / 1000).toFixed(1)}s, ${row.candidates} Kandidaten, ${row.rejected} verworfen)`);
    } catch (err) {
      console.log(`FEHLER: ${(err as Error).message}`);
      rows.push({
        genre: f.genre, file: f.file, status: 'ERROR', durationMs: 0, candidates: 0, rejected: 0,
        localQaPassed: 0, critiqueScores: [], critiqueSource: 'keine', selected: null,
        selectionSource: '—', qaPassed: null, qaFailures: [], model: '—', quality: '—', size: '—',
        degradations: 0, estimatedCostUsd: 0, error: (err as Error).message,
      });
    }
  }
  await orchestrator.stop();

  const completed = rows.filter((r) => r.status === 'COMPLETED');
  const allScores = rows.flatMap((r) => r.critiqueScores);
  const report = {
    generated_at: new Date().toISOString(),
    test_mode: cfg.testMode,
    disclaimer: cfg.testMode
      ? 'TEST_MODE: Die Bilder sind synthetische Platzhalter. Diese Zahlen belegen die Funktion der Pipeline, NICHT die Bildqualität.'
      : 'Echte API-Nutzung. Kosten sind Schätzwerte auf Basis der veröffentlichten Token-Preise.',
    configuration: {
      quality_mode: cfg.qualityMode,
      requested_model: cfg.imageModel,
      requested_quality: requested.quality,
      quality_source: requested.source,
      requested_size: cfg.resolution,
      candidates_per_script: mode.variants,
      refinement_passes: mode.refinementPasses,
    },
    totals: {
      scripts: rows.length,
      completed: completed.length,
      failed: rows.length - completed.length,
      candidates_generated: rows.reduce((a, r) => a + r.candidates, 0),
      candidates_rejected: rows.reduce((a, r) => a + r.rejected, 0),
      local_qa_passed: rows.reduce((a, r) => a + r.localQaPassed, 0),
      final_qa_passed: rows.filter((r) => r.qaPassed).length,
      quality_degradations: rows.reduce((a, r) => a + r.degradations, 0),
      estimated_cost_usd: Number(rows.reduce((a, r) => a + r.estimatedCostUsd, 0).toFixed(3)),
      mean_latency_ms: completed.length
        ? Math.round(completed.reduce((a, r) => a + r.durationMs, 0) / completed.length)
        : 0,
      critique_score_min: allScores.length ? Math.min(...allScores) : null,
      critique_score_max: allScores.length ? Math.max(...allScores) : null,
      critique_score_mean: allScores.length
        ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2))
        : null,
    },
    rows,
  };

  const outDir = path.resolve('data/runtime');
  await fsp.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fsp.writeFile(outFile, JSON.stringify(report, null, 2));

  console.log('\n================= ZUSAMMENFASSUNG =================');
  console.table(
    rows.map((r) => ({
      Genre: r.genre,
      Status: r.status,
      's': (r.durationMs / 1000).toFixed(1),
      Kand: r.candidates,
      Verw: r.rejected,
      'QA lokal': r.localQaPassed,
      Scores: r.critiqueScores.join('/') || '—',
      Wahl: r.selected ?? '—',
      'QA final': r.qaPassed === null ? '—' : r.qaPassed ? 'OK' : 'FEHL',
      Modell: r.model,
      Qual: r.quality,
      Größe: r.size,
      'Abw.': r.degradations,
      '$': r.estimatedCostUsd.toFixed(3),
    })),
  );
  console.log(report.disclaimer);
  console.log(`Bericht gespeichert: ${outFile}`);
  console.log('===================================================\n');
  process.exit(completed.length === rows.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
