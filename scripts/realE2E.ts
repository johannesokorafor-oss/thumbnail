/**
 * ECHTER End-to-End-Test gegen die OpenAI-API.
 *
 * Dieser Test ist bewusst NICHT Teil von `npm test`: Er kostet echtes Geld und
 * benötigt einen gültigen OPENAI_API_KEY. Er ist der einzige Test, der die
 * Aussage "echte Bildgenerierung funktioniert" belegen darf.
 *
 *   OPENAI_API_KEY=sk-... npm run e2e:real
 *   OPENAI_API_KEY=sk-... npm run e2e:real -- --script data/examples/Die_Nacht_in_der_Rom_brannte.md
 *
 * Der Lauf bricht hart ab, wenn kein Key gesetzt ist oder TEST_MODE aktiv ist —
 * ein Mock-Durchlauf darf niemals als echter API-Test gelten.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ensureWorkspaceFolders, getConfig, qualityModeSettings, resolveRequestedQuality } from '../src/config/index.js';
import { getImageProvider } from '../src/ai/providers/registry.js';
import { orchestrator } from '../src/pipeline/orchestrator.js';
import { jobManager } from '../src/pipeline/jobs/jobManager.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const cfg = getConfig();

  // ---- Hard preconditions: no silent mock fallback ----
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      '\nABBRUCH: Kein OPENAI_API_KEY gesetzt.\n' +
        'Dieser Test führt echte, kostenpflichtige API-Aufrufe aus und kann nicht simuliert werden.\n' +
        'Ein TEST_MODE-Lauf ist KEIN Nachweis für echte Bildgenerierung.\n',
    );
    process.exit(2);
  }
  if (cfg.testMode) {
    console.error('\nABBRUCH: TEST_MODE ist aktiv. Bitte TEST_MODE=false setzen.\n');
    process.exit(2);
  }

  ensureWorkspaceFolders(cfg);
  const mode = qualityModeSettings(cfg.qualityMode);
  const requested = resolveRequestedQuality(cfg);

  console.log('=============== ECHTER API-TEST ===============');
  console.log(`Provider:            ${cfg.imageProvider}`);
  console.log(`Bildmodell (Soll):   ${cfg.imageModel}`);
  console.log(`Analysemodell:       ${cfg.analysisModel}`);
  console.log(`Qualitätsmodus:      ${cfg.qualityMode} (premium=${mode.premium})`);
  console.log(`Qualität (Soll):     ${requested.quality} [Quelle: ${requested.source}]`);
  console.log(`Größe (Soll):        ${cfg.resolution}`);
  console.log(`Kandidaten:          ${mode.variants}, Verfeinerungen: ${mode.refinementPasses}`);
  console.log(`Fallbacks erlaubt:   Qualität=${mode.allowQualityFallback}, Modell=${mode.allowModelFallback}`);
  console.log('===============================================\n');

  // ---- Model availability check before spending money ----
  const provider = getImageProvider();
  if (!(await provider.isAvailable())) {
    console.error('ABBRUCH: Bild-Provider nicht erreichbar (Key ungültig oder Netzwerkproblem).');
    process.exit(3);
  }
  const supported = await provider.supportsModel(cfg.imageModel);
  console.log(`Modellprüfung: ${cfg.imageModel} ${supported ? 'verfügbar' : 'NICHT bestätigt'}\n`);

  const scriptPath = path.resolve(arg('script', 'data/examples/Alchemie_Das_verbotene_Wissen.md')!);
  if (!fs.existsSync(scriptPath)) {
    console.error(`ABBRUCH: Skript nicht gefunden: ${scriptPath}`);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(cfg.inputFolder, `REAL_${stamp}_${path.basename(scriptPath)}`);

  await orchestrator.start();
  // Zeitstempel anhängen => neuer SHA-256-Hash => kein Duplikat-Skip
  fs.writeFileSync(target, `${fs.readFileSync(scriptPath, 'utf8')}\n\n<!-- Realer API-Lauf ${stamp} -->\n`);
  console.log(`Skript eingelegt: ${target}\nWarte auf Abschluss ...\n`);

  const startedAt = Date.now();
  const jobId = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout nach 30 Minuten.')), 1_800_000);
    jobManager.on('job', (job) => {
      if (job.sourceFile === target && ['COMPLETED', 'FAILED', 'WAITING'].includes(job.status)) {
        clearTimeout(timeout);
        resolve(job.id);
      }
    });
  });
  const job = jobManager.get(jobId)!;
  await orchestrator.stop();

  // ---- Proof section: what actually happened ----
  console.log('\n================ ERGEBNIS ================');
  console.log(`Status:              ${job.status}`);
  console.log(`Dauer:               ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (job.error) console.log(`Fehler:              ${job.error.message}`);
  if (job.generation) {
    const g = job.generation;
    console.log(`Modell Soll/Ist:     ${g.requestedModel} -> ${g.actualModel}`);
    console.log(`Qualität Soll/Ist:   ${g.requestedQuality} -> ${g.actualQuality} [${g.qualitySource}]`);
    console.log(`Größe Soll/Ist:      ${g.requestedSize} -> ${g.actualSize}`);
    console.log(`Premium-Modus:       ${g.premium}`);
    console.log(`Abweichungen:        ${g.degradations.length === 0 ? 'keine' : ''}`);
    for (const d of g.degradations) console.log(`  - [${d.kind}] ${d.requested} -> ${d.actual}: ${d.reason}`);
  }
  console.log(`Kandidaten:          ${job.variants?.length ?? 0} generiert, ${job.rejectedCount ?? 0} verworfen`);
  for (const v of job.variants ?? []) {
    const failed = v.localQa?.checks.filter((c) => !c.passed).map((c) => c.name) ?? [];
    console.log(
      `  #${v.index} ${v.rejected ? 'VERWORFEN' : 'aktiv'} | lokale QA: ${v.localQa?.passed ? 'bestanden' : `fehlgeschlagen (${failed.join(', ')})`}` +
        ` | Kritik: ${v.critique ? v.critique.scoreTotal.toFixed(2) : '—'} (${v.critique?.source ?? 'keine'})` +
        ` | ${v.latencyMs ?? 0}ms${v.rejectionReason ? ` | ${v.rejectionReason}` : ''}`,
    );
  }
  if (job.ranking) {
    console.log(`Visueller Vergleich: Reihenfolge ${job.ranking.order.join(' > ')} (Quelle: ${job.ranking.source})`);
    console.log(`Begründung:          ${job.ranking.reason}`);
  }
  console.log(`Gewählte Variante:   ${job.selectedVariant ?? '—'}`);
  console.log(`QA insgesamt:        ${job.qa?.passed ? 'bestanden' : 'nicht bestanden'}`);
  for (const c of job.qa?.checks ?? []) console.log(`  [${c.passed ? 'OK ' : 'FEHL'}] ${c.name}: ${c.detail}`);
  console.log(`Kosten (Schätzung):  $${(job.estimatedCostUsd ?? 0).toFixed(3)}`);

  // ---- Verify the exported file really is a usable thumbnail ----
  if (job.outputDir) {
    const finalPath = path.join(job.outputDir, 'FINAL_THUMBNAIL.jpg');
    if (fs.existsSync(finalPath)) {
      const buf = await fsp.readFile(finalPath);
      const meta = await sharp(buf).metadata();
      const sizeMb = buf.byteLength / 1_048_576;
      console.log('\nExportprüfung:');
      console.log(`  Datei:      ${finalPath}`);
      console.log(`  Format:     ${meta.format} ${meta.width}x${meta.height}`);
      console.log(`  Größe:      ${sizeMb.toFixed(2)} MB (YouTube-Limit 2 MB: ${sizeMb <= 2 ? 'OK' : 'ZU GROSS'})`);
      console.log(`  16:9:       ${Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 16 / 9) < 0.01 ? 'OK' : 'ABWEICHUNG'}`);
      console.log(`  Uploadfähig: ${meta.format === 'jpeg' && sizeMb <= 2 && (meta.width ?? 0) >= 1280 ? 'JA' : 'NEIN'}`);
    } else {
      console.log('\nExportprüfung: FINAL_THUMBNAIL.jpg wurde nicht erzeugt.');
    }
  }
  console.log('==========================================\n');

  process.exit(job.status === 'COMPLETED' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
