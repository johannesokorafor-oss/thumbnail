/**
 * Echter End-to-End-Durchlauf über den überwachten Input-Ordner.
 * Nutzt TEST_MODE, wenn kein API-Key gesetzt ist.
 *   npm run e2e
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureWorkspaceFolders, getConfig } from '../src/config/index.js';
import { orchestrator } from '../src/pipeline/orchestrator.js';
import { jobManager } from '../src/pipeline/jobs/jobManager.js';
import { jobQueue } from '../src/pipeline/queue/queue.js';
import { logger } from '../src/utils/logger.js';

async function main() {
const cfg = getConfig();
ensureWorkspaceFolders(cfg);

const example = path.resolve('data/examples/Alchemie_Das_verbotene_Wissen.md');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(cfg.inputFolder, `E2E_${stamp}_Alchemie_Das_verbotene_Wissen.md`);

await orchestrator.start();
console.log(`\n▶ Lege Testskript in den Input-Ordner: ${target}`);
// Zeitstempel anhaengen => neuer SHA-256-Hash => kein Duplikat-Skip
fs.writeFileSync(target, `${fs.readFileSync(example, 'utf8')}\n\n<!-- E2E-Lauf ${stamp} -->\n`);

const completed = await new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout: Job wurde nicht abgeschlossen.')), 600_000);
  jobManager.on('job', (job) => {
    if (['COMPLETED', 'FAILED', 'WAITING', 'REJECTED'].includes(job.status) && job.sourceFile === target) {
      clearTimeout(timeout);
      resolve(job.id);
    }
  });
});

const job = jobManager.get(completed)!;
await orchestrator.stop();

console.log('\n================ E2E-ERGEBNIS ================');
console.log(`Status:            ${job.status}`);
console.log(`Datei erkannt:     ${job.fileName}`);
console.log(`Videotitel:        ${job.videoTitle}`);
console.log(`Thumbnail-Text:    ${job.thumbnailText}`);
console.log(`Konzepte:          ${job.concepts?.length ?? 0}`);
console.log(`Varianten:         ${job.variants?.length ?? 0}`);
console.log(`Gewählte Variante: ${job.selectedVariant} (${job.selectionReason})`);
console.log(`Design-Score:      ${job.finalScore}`);
console.log(`QA bestanden:      ${job.qa?.passed}`);
console.log(`Kosten (Schätzung): $${job.estimatedCostUsd?.toFixed(3)}`);
console.log(`Ausgabeordner:     ${job.outputDir}`);
if (job.outputDir) console.log(`Dateien:           ${fs.readdirSync(job.outputDir).join(', ')}`);
if (job.error) console.log(`Fehler:            ${job.error.message}`);
console.log(`Logeinträge:       ${logger.recent().length}`);
console.log('==============================================\n');

if (job.status !== 'COMPLETED') process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error('E2E fehlgeschlagen:', err);
  process.exit(1);
});
