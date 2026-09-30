import fs from 'node:fs';
import sharp from 'sharp';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getChannelProfile, getConfig, qualityModeSettings, resolveRequestedQuality } from '../config/index.js';
import { parserRegistry, type ParsedScript } from '../files/parser/index.js';
import { getImageProvider, getTextProvider } from '../ai/providers/registry.js';
import { analyzeScript } from '../ai/analysis/scriptAnalyzer.js';
import {
  computeScoreTotal,
  generateConcepts,
  generateThumbnailText,
  selectBestVariant,
  selectTopConcepts,
} from '../ai/thumbnail/strategist.js';
import { buildImagePrompt, buildRefinementPrompt, formatPromptFile } from '../ai/prompting/promptBuilder.js';
import {
  critiqueVariant,
  extractReferenceStyle,
  finalCompositionCheck,
  rankCandidatesVisually,
} from '../ai/critique/imageCritic.js';
import { findNearDuplicates, runCandidateQa } from '../image/validation/candidateQa.js';
import { choosePlacement } from '../image/overlay/placement.js';
import { pickAccentHue } from '../image/overlay/colorAnalysis.js';
import { formatSize, resolveRequestSize, parseSize as parseApiSize } from '../image/size.js';
import { renderTextOverlay } from '../image/overlay/textOverlay.js';
import { makeMobilePreview, normalizeToTarget, parseSize, toJpeg } from '../image/processing/normalize.js';
import { runQualityAssurance } from '../image/validation/qa.js';
import { jobManager } from './jobs/jobManager.js';
import { costTracker, ANALYSIS_CALL_ESTIMATE, estimateImageCost } from './costTracker.js';
import { logger } from '../utils/logger.js';
import { PermanentError, isTransient } from '../utils/retry.js';
import { sanitizeName, uniqueDirName } from '../utils/sanitize.js';
import { sha256OfFile, shortId } from '../utils/hash.js';
import type {
  GeneratedVariant,
  Job,
  ScriptAnalysis,
  ThumbnailAnalysisFile,
  ThumbnailConcept,
  VisualRanking,
} from '../types/index.js';

export interface RunOptions {
  /** Re-run an existing job from a specific stage (section 44). */
  resumeFrom?: 'analysis' | 'concepts' | 'generation' | 'critique' | 'overlay';
  /** Override the thumbnail text (manual "CHANGE TEXT"). */
  textOverride?: string;
  /** Regenerate only this variant index. */
  onlyVariant?: number;
  conceptOverride?: Partial<ThumbnailConcept>;
}

function nowIso() {
  return new Date().toISOString();
}

async function readReferenceImages(folder: string, limit = 4): Promise<string[]> {
  try {
    const entries = await fsp.readdir(folder);
    return entries
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .slice(0, limit)
      .map((f) => path.join(folder, f));
  } catch {
    return [];
  }
}


/**
 * Reject the entire candidate set.
 *
 * Deliberately does NOT export a FINAL_THUMBNAIL: a weak image must not look
 * like a finished deliverable. All candidates and a written report stay on
 * disk so the failure can be inspected and the job re-run.
 */
async function rejectCandidateSet(input: {
  jobId: string;
  outputDir: string;
  variants: GeneratedVariant[];
  stage: string;
  summary: string;
  details: string[];
  minScore: number;
}): Promise<Job> {
  const { jobId, outputDir, variants, stage, summary, details, minScore } = input;
  const report = {
    rejected_at: nowIso(),
    stage,
    summary,
    minimum_required_score: minScore,
    details,
    candidates: variants.map((v) => ({
      index: v.index,
      file: v.file,
      score: v.critique?.scoreTotal ?? null,
      critique_source: v.critique?.source ?? null,
      main_weakness: v.critique?.defects?.[0] ?? v.critique?.reasons?.[0] ?? v.rejectionReason ?? null,
      local_qa_failed: v.localQa?.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`) ?? [],
      rejection_reason: v.rejectionReason ?? null,
    })),
    note:
      'Es wurde bewusst kein FINAL_THUMBNAIL exportiert. Ein schwacher Kandidat soll nicht ' +
      'dadurch zum "besten" werden, dass die anderen noch schwächer sind.',
  };
  try {
    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.writeFile(path.join(outputDir, 'REJECTION_REPORT.json'), JSON.stringify(report, null, 2));
  } catch (err) {
    logger.warn('Ablehnungsbericht konnte nicht geschrieben werden', {
      job_id: jobId, stage, error: (err as Error).message,
    });
  }

  logger.error(`${summary} ${details.join(' ')}`, { job_id: jobId, stage, success: false });

  return jobManager.setStatus(jobId, 'REJECTED', {
    variants,
    rejectedCount: variants.length,
    estimatedCostUsd: costTracker.jobTotal(jobId),
    error: {
      message: `${summary} ${details.join(' ')}`.trim(),
      stage,
      code: 'ALL_CANDIDATES_REJECTED',
      permanent: false,
      at: nowIso(),
    },
  });
}

/** Create (or reuse) the job record for a script file, with duplicate detection. */
export function registerScript(filePath: string, force = false): { job?: Job; skipped?: string } {
  const fileName = path.basename(filePath);
  let hash: string;
  try {
    hash = sha256OfFile(filePath);
  } catch (err) {
    throw new PermanentError(`Datei nicht lesbar: ${(err as Error).message}`, 'FILE_READ_ERROR');
  }

  const existing = jobManager.findByHash(hash);
  if (existing && !force) {
    logger.info(`Datei bereits verarbeitet, übersprungen: ${fileName}`, { stage: 'duplicate_check', file: fileName });
    return { skipped: existing.jobId };
  }

  const job: Job = {
    id: shortId('job'),
    sourceFile: filePath,
    fileName,
    hash,
    status: 'DETECTED',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    iterationCount: 0,
    generationCount: 0,
    estimatedCostUsd: 0,
    steps: [{ stage: 'DETECTED', label: 'Skript erkannt', at: nowIso() }],
  };
  jobManager.create(job);
  return { job };
}

/** The full pipeline (section 43). */
export async function runPipeline(jobId: string, opts: RunOptions = {}): Promise<Job> {
  const cfg = getConfig();
  const profile = getChannelProfile();
  const modeSettings = qualityModeSettings(cfg.qualityMode);
  const textProvider = getTextProvider();
  const imageProvider = getImageProvider();
  const targetSize = parseSize(cfg.resolution);
  // What we ASK the API for — resolved once and reported everywhere.
  const requestedQuality = resolveRequestedQuality(cfg);
  const quality = requestedQuality.quality;
  const sizeResolution = resolveRequestSize(parseApiSize(cfg.resolution));
  // TEST_MODE cannot judge visual quality: its "scores" are pixel measurements of
  // placeholder artwork. Gating on them would be a fake quality statement, so the
  // gate is disabled unless a threshold is set explicitly.
  const minAcceptableScore = cfg.minThumbnailScore ?? (cfg.testMode ? 0 : modeSettings.minAcceptableScore);
  if (minAcceptableScore === 0) {
    logger.warn(
      'Qualitäts-Schwelle deaktiviert (TEST_MODE oder MIN_THUMBNAIL_SCORE=0): ' +
        'das Ergebnis dieses Laufs ist keine Aussage über Bildqualität.',
      { job_id: jobId, stage: 'quality_gate' },
    );
  }
  const requestSize = formatSize(sizeResolution.size);
  const variantCount = Math.max(1, Math.min(cfg.maxVariantCount, cfg.testMode ? cfg.variantCount : Math.min(modeSettings.variants, cfg.variantCount || modeSettings.variants)));

  let job = jobManager.get(jobId);
  if (!job) throw new Error(`Job ${jobId} nicht gefunden`);
  costTracker.resetJob(jobId);
  const startedAt = Date.now();

  try {
    // ---------- Provider availability (section 44) ----------
    if (!(await imageProvider.isAvailable())) {
      jobManager.setStatus(jobId, 'WAITING', {
        error: {
          message: 'Bild-Provider nicht erreichbar oder kein API-Key konfiguriert. TEST_MODE aktivieren oder Key hinterlegen.',
          stage: 'provider_check',
          permanent: false,
          at: nowIso(),
        },
      });
      return jobManager.get(jobId)!;
    }

    // ---------- Output folder ----------
    const parsed: ParsedScript = await parserRegistry.parse(job.sourceFile);
    const baseSlug = sanitizeName(job.analysis?.VIDEO_TITLE ?? parsed.titleGuess);
    const slug =
      job.slug ??
      uniqueDirName(baseSlug, (name) => fs.existsSync(path.join(cfg.outputFolder, name)));
    const outputDir = path.join(cfg.outputFolder, slug);
    await fsp.mkdir(outputDir, { recursive: true });
    job = jobManager.update(jobId, { slug, outputDir });

    // ---------- 1. Script analysis ----------
    let analysis: ScriptAnalysis | undefined = job.analysis;
    let analysisModelUsed = cfg.testMode ? 'mock-analysis-model' : cfg.analysisModel;
    if (!analysis || !opts.resumeFrom || opts.resumeFrom === 'analysis') {
      jobManager.setStatus(jobId, 'ANALYZING');
      costTracker.assertWithinBudget(jobId, ANALYSIS_CALL_ESTIMATE);
      const t0 = Date.now();
      analysis = await analyzeScript({
        provider: textProvider,
        script: parsed,
        language: cfg.defaultLanguage,
        jobId,
        onModel: (m) => (analysisModelUsed = m),
      });
      costTracker.record({ jobId, kind: 'analysis', model: analysisModelUsed, count: 1, estimatedUsd: ANALYSIS_CALL_ESTIMATE });
      logger.info('Skriptanalyse abgeschlossen', {
        job_id: jobId,
        stage: 'analysis',
        model: analysisModelUsed,
        duration_ms: Date.now() - t0,
        success: true,
      });
      job = jobManager.update(jobId, { analysis, videoTitle: analysis.VIDEO_TITLE });
    }

    // ---------- 2. Thumbnail strategy ----------
    let concepts: ThumbnailConcept[] = job.concepts ?? [];
    if (!concepts.length || ['analysis', 'concepts'].includes(opts.resumeFrom ?? 'analysis')) {
      jobManager.setStatus(jobId, 'DESIGNING');
      const refImages = await readReferenceImages(cfg.referenceFolder);
      let referenceStyle = '';
      if (refImages.length) {
        try {
          referenceStyle = await extractReferenceStyle({ provider: textProvider, imagePaths: refImages, jobId });
        } catch (err) {
          logger.warn('Referenzstil konnte nicht abgeleitet werden', { job_id: jobId, stage: 'reference', error: (err as Error).message });
        }
      }
      costTracker.assertWithinBudget(jobId, ANALYSIS_CALL_ESTIMATE);
      concepts = await generateConcepts({
        provider: textProvider,
        analysis: analysis!,
        profile,
        conceptCount: modeSettings.concepts,
        jobId,
        referenceStyle,
      });
      costTracker.record({ jobId, kind: 'analysis', model: analysisModelUsed, count: 1, estimatedUsd: ANALYSIS_CALL_ESTIMATE });
      if (!concepts.length) throw new Error('Es konnten keine Thumbnail-Konzepte erzeugt werden.');
      job = jobManager.update(jobId, { concepts, conceptSummary: concepts[0]?.idea });
    }

    const chosenConcepts = selectTopConcepts(concepts, variantCount).map((c) =>
      opts.conceptOverride ? { ...c, ...opts.conceptOverride } : c,
    );

    // ---------- 3. Image generation ----------
    jobManager.setStatus(jobId, 'GENERATING');
    const variants: GeneratedVariant[] = [];
    const allDegradations: Array<{ kind: string; requested: string; actual: string; reason: string }> = [];
    if (sizeResolution.note) {
      allDegradations.push({ kind: 'size', requested: cfg.resolution, actual: requestSize, reason: sizeResolution.note });
      logger.warn(sizeResolution.note, { job_id: jobId, stage: 'size_resolution' });
    }
    const keepExisting = opts.onlyVariant !== undefined ? job.variants ?? [] : [];

    // Resuming at 'overlay'/'critique' must not re-run image generation.
    const reuseVariants = (opts.resumeFrom === 'overlay' || opts.resumeFrom === 'critique') && (job.variants?.length ?? 0) > 0;
    for (let i = 0; reuseVariants ? i < (job.variants?.length ?? 0) : i < chosenConcepts.length; i++) {
      const index = i + 1;
      if (reuseVariants) {
        const prev = job.variants![i];
        if (fs.existsSync(prev.file)) {
          variants.push(prev);
          continue;
        }
      }
      if (opts.onlyVariant !== undefined && opts.onlyVariant !== index) {
        const prev = keepExisting.find((v) => v.index === index);
        if (prev) variants.push(prev);
        continue;
      }
      const concept = chosenConcepts[i];
      const prompt = buildImagePrompt({
        concept,
        analysis: analysis!,
        profile,
        textMode: cfg.textMode,
        thumbnailText: concept.thumbnailText,
      });
      const estimate = estimateImageCost(cfg.imageModel, quality, 1, cfg.resolution);
      costTracker.assertWithinBudget(jobId, estimate);

      const t0 = Date.now();
      const [image] = await imageProvider.generate({
        prompt,
        model: cfg.imageModel,
        size: requestSize,
        quality,
        n: 1,
        outputFormat: 'png',
        jobId,
        allowQualityFallback: modeSettings.allowQualityFallback,
        allowModelFallback: modeSettings.allowModelFallback,
      });
      for (const d of image.degradations) {
        allDegradations.push(d);
        logger.warn(`Qualitätsabweichung (${d.kind}): ${d.requested} -> ${d.actual}`, {
          job_id: jobId, stage: 'image_generation', error: d.reason, success: false,
        });
      }
      costTracker.record({
        jobId, kind: 'image', model: image.model, quality: image.quality,
        size: image.size, count: 1, estimatedUsd: estimateImageCost(image.model, image.quality, 1, image.size),
      });

      const normalized = await normalizeToTarget(image.data, targetSize);
      const file = path.join(outputDir, `VARIANT_${String(index).padStart(2, '0')}.png`);
      await fsp.writeFile(file, normalized);
      await fsp.writeFile(file.replace(/\.png$/, '.jpg'), await toJpeg(normalized, 90));

      // Stage 1 — deterministic QA on the real pixels, before any AI critique.
      const localQa = await runCandidateQa({
        image: normalized,
        targetSize: `${targetSize.width}x${targetSize.height}`,
        textArea: concept.textArea,
      });

      variants.push({
        index, conceptId: concept.id, file, prompt,
        model: image.model, quality: image.quality, size: `${targetSize.width}x${targetSize.height}`,
        requested: image.requested,
        degradations: image.degradations,
        latencyMs: image.latencyMs,
        localQa,
        iteration: 1,
      });
      logger.info(`Variante ${index} generiert`, {
        job_id: jobId, stage: 'image_generation', model: image.model,
        quality: image.quality, size: image.size,
        duration_ms: Date.now() - t0, success: true,
      });
      if (!localQa.passed) {
        logger.warn(
          `Variante ${index} scheitert an der lokalen Qualitätsprüfung: ${localQa.checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
          { job_id: jobId, stage: 'candidate_qa', success: false },
        );
      }
      job = jobManager.update(jobId, {
        variants: [...variants],
        generationCount: (job.generationCount ?? 0) + 1,
        estimatedCostUsd: costTracker.jobTotal(jobId),
      });
    }

    // ---------- 4. Stage-1 gate: reject candidates that already failed locally ----------
    jobManager.setStatus(jobId, 'EVALUATING');

    const duplicates = findNearDuplicates(
      variants
        .filter((v) => v.localQa)
        .map((v) => ({
          index: v.index,
          hash: v.localQa!.hash,
          score: chosenConcepts.find((c) => c.id === v.conceptId)?.scoreTotal ?? 0,
        })),
    );
    for (const dup of duplicates) {
      const v = variants.find((x) => x.index === dup.index);
      if (v) {
        v.rejected = true;
        v.rejectionReason = `Nahezu identisch mit Kandidat ${dup.duplicateOf} (Hash-Abstand ${dup.distance}).`;
      }
    }
    for (const v of variants) {
      if (v.rejected || !v.localQa || v.localQa.passed) continue;
      v.rejected = true;
      v.rejectionReason = `Lokale Qualitätsprüfung fehlgeschlagen: ${v.localQa.checks
        .filter((c) => !c.passed)
        .map((c) => `${c.name} (${c.detail})`)
        .join('; ')}`;
    }

    // A weak candidate must not become "the best" just because the others are
    // worse. If nothing survives Stage 1, the whole set is rejected.
    const survivors = variants.filter((v) => !v.rejected);
    const rejectedCount = variants.filter((v) => v.rejected).length;
    if (!survivors.length && variants.length) {
      return await rejectCandidateSet({
        jobId,
        outputDir,
        variants,
        stage: 'candidate_qa',
        summary: 'Kein einziger Kandidat hat die lokale Qualitätsprüfung bestanden.',
        details: variants.map(
          (v) => `Kandidat ${v.index}: ${v.rejectionReason ?? 'ohne Begründung'}`,
        ),
        minScore: minAcceptableScore,
      });
    }

    // ---------- 5. Stage-2 AI critique on the actual pixels ----------
    for (const variant of survivors) {
      if (variant.critique && opts.onlyVariant !== undefined && opts.onlyVariant !== variant.index) continue;
      const concept = chosenConcepts.find((c) => c.id === variant.conceptId) ?? chosenConcepts[0];
      try {
        costTracker.assertWithinBudget(jobId, ANALYSIS_CALL_ESTIMATE);
        variant.critique = await critiqueVariant({
          provider: textProvider,
          imagePath: variant.file,
          concept,
          analysis: analysis!,
          jobId,
          depth: modeSettings.critique,
        });
        costTracker.record({ jobId, kind: 'analysis', model: analysisModelUsed, count: 1, estimatedUsd: ANALYSIS_CALL_ESTIMATE });
      } catch (err) {
        // A failed critique must not kill the job — fall back to the concept score.
        logger.warn(`Bewertung von Variante ${variant.index} fehlgeschlagen`, {
          job_id: jobId, stage: 'critique', error: (err as Error).message,
        });
        variant.critique = undefined;
      }
    }
    job = jobManager.update(jobId, { variants: [...variants], rejectedCount, estimatedCostUsd: costTracker.jobTotal(jobId) });

    // ---------- 6. Selection by direct VISUAL comparison ----------
    let ranking: VisualRanking | undefined;
    let selection: { selectedIndex: number; reason: string };
    try {
      costTracker.assertWithinBudget(jobId, ANALYSIS_CALL_ESTIMATE);
      ranking = await rankCandidatesVisually({
        provider: textProvider,
        jobId,
        analysis: analysis!,
        candidates: survivors.map((v) => {
          const c = chosenConcepts.find((x) => x.id === v.conceptId);
          return {
            index: v.index,
            file: v.file,
            conceptLabel: c?.label ?? v.conceptId,
            strategy: c?.strategy ?? 'UNBEKANNT',
          };
        }),
      });
      costTracker.record({ jobId, kind: 'analysis', model: analysisModelUsed, count: 1, estimatedUsd: ANALYSIS_CALL_ESTIMATE });
      selection = { selectedIndex: ranking.winner, reason: ranking.reason };
    } catch (err) {
      logger.warn('Visueller Direktvergleich fehlgeschlagen – wähle über die Einzelbewertungen', {
        job_id: jobId, stage: 'ranking', error: (err as Error).message,
      });
      const summaries = survivors.map((v) => {
        const concept = chosenConcepts.find((c) => c.id === v.conceptId);
        return {
          index: v.index,
          concept: `${concept?.label ?? v.conceptId}: ${concept?.idea ?? ''}`,
          critique: v.critique?.summary ?? 'keine Bewertung verfügbar',
          scoreTotal: v.critique?.scoreTotal ?? concept?.scoreTotal ?? 0,
        };
      });
      try {
        selection = await selectBestVariant({ provider: textProvider, jobId, analysis: analysis!, summaries });
      } catch {
        const best = [...summaries].sort((a, b) => b.scoreTotal - a.scoreTotal)[0];
        selection = { selectedIndex: best.index, reason: 'Automatische Auswahl über den Bewertungs-Score der echten Bilder.' };
      }
    }
    let selected = survivors.find((v) => v.index === selection.selectedIndex) ?? survivors[0];

    // Honest quality gate: if even the winner is weak, do not present it as a
    // finished thumbnail. Everything stays on disk for inspection.
    const scored = survivors.filter((v) => v.critique);
    // Only a real vision judgement may declare a set "generic" — a mock verdict
    // must never reject real work, and must never pass as a quality statement.
    const judgedByVision = scored.filter((v) => v.critique!.source === 'vision-model');
    if (scored.length) {
      const bestScore = Math.max(...scored.map((v) => v.critique!.scoreTotal));
      const allGeneric = judgedByVision.length > 0 && judgedByVision.every((v) => v.critique!.feelsGeneric);
      const noneUsableSmall = judgedByVision.length > 0 && judgedByVision.every((v) => !v.critique!.smallSizeReadable);
      if ((minAcceptableScore > 0 && bestScore < minAcceptableScore) || allGeneric || noneUsableSmall) {
        const why: string[] = [];
        if (bestScore < minAcceptableScore) {
          why.push(`Bester Bewertungswert ${bestScore.toFixed(2)} liegt unter der Mindestschwelle ${minAcceptableScore.toFixed(2)}.`);
        }
        if (allGeneric) why.push('Die Bildkritik hält jeden Kandidaten für generisch wirkend.');
        if (noneUsableSmall) why.push('Kein Kandidat ist in der 320px-Feed-Ansicht lesbar.');
        return await rejectCandidateSet({
          jobId,
          outputDir,
          variants,
          stage: 'quality_gate',
          summary: 'Kein Kandidat erreicht die Qualitätsschwelle – es wird bewusst kein Thumbnail zum Upload angeboten.',
          details: [
            ...why,
            ...scored.map((v) => {
              const c = v.critique!;
              const weakness = c.defects[0] ?? c.reasons[0] ?? c.summary;
              return `Kandidat ${v.index}: ${c.scoreTotal.toFixed(2)} – Hauptschwäche: ${weakness}`;
            }),
          ],
          minScore: minAcceptableScore,
        });
      }
    }

    const selectedConcept = chosenConcepts.find((c) => c.id === selected.conceptId) ?? chosenConcepts[0];

    // ---------- 6b. Targeted refinement passes (re-evaluated every time) ----------
    let iterationCount = 1;
    for (let pass = 0; pass < modeSettings.refinementPasses; pass++) {
      const critique = selected.critique;
      const needsImprovement =
        critique &&
        (critique.scoreTotal < 8 ||
          critique.overloaded ||
          critique.feelsGeneric ||
          !critique.textAreaSufficient ||
          !critique.smallSizeReadable ||
          critique.artifacts.length > 0 ||
          critique.defects.length > 0);
      if (!needsImprovement || !critique) break;
      // Only worth an edit when the critic says the image idea itself is sound.
      if (!critique.fixableByEdit && !critique.improvementPrompt) break;

      try {
        const estimate = estimateImageCost(cfg.imageModel, quality, 1, requestSize);
        costTracker.assertWithinBudget(jobId, estimate);
        const current = await fsp.readFile(selected.file);
        const instruction = critique.improvementPrompt || critique.defects.join(' ');

        let improved;
        if (imageProvider.refine) {
          improved = await imageProvider.refine({
            image: current,
            instruction,
            prompt: buildRefinementPrompt({
              concept: selectedConcept,
              instruction,
              defects: critique.defects,
              textArea: selectedConcept.textArea,
            }),
            size: requestSize,
            quality,
            outputFormat: 'png',
            jobId,
            allowQualityFallback: modeSettings.allowQualityFallback,
            allowModelFallback: modeSettings.allowModelFallback,
          });
        } else {
          [improved] = await imageProvider.generate({
            prompt: buildImagePrompt({
              concept: selectedConcept, analysis: analysis!, profile,
              textMode: cfg.textMode, thumbnailText: selectedConcept.thumbnailText,
              improvement: instruction,
            }),
            size: requestSize, quality, n: 1, outputFormat: 'png', jobId,
            allowQualityFallback: modeSettings.allowQualityFallback,
            allowModelFallback: modeSettings.allowModelFallback,
          });
        }
        for (const d of improved.degradations) allDegradations.push(d);

        const normalized = await normalizeToTarget(improved.data, targetSize);
        const refinedFile = selected.file.replace(/\.png$/, `_refined${pass + 1}.png`);
        await fsp.writeFile(refinedFile, normalized);

        const refinedQa = await runCandidateQa({
          image: normalized,
          targetSize: `${targetSize.width}x${targetSize.height}`,
          textArea: selectedConcept.textArea,
        });
        const refinedCritique = await critiqueVariant({
          provider: textProvider, imagePath: refinedFile, concept: selectedConcept,
          analysis: analysis!, jobId, depth: modeSettings.critique,
        });
        costTracker.record({
          jobId, kind: 'image', model: improved.model, quality: improved.quality,
          size: improved.size, count: 1, estimatedUsd: estimateImageCost(improved.model, improved.quality, 1, improved.size),
        });

        // Keep the refinement only if it is better on BOTH axes: the critic's
        // score must rise and the deterministic QA must not regress.
        const qaBefore = selected.localQa?.checks.filter((c) => c.passed).length ?? 0;
        const qaAfter = refinedQa.checks.filter((c) => c.passed).length;
        const scoreImproved = refinedCritique.scoreTotal > critique.scoreTotal;
        const qaHeld = qaAfter >= qaBefore;
        if (scoreImproved && qaHeld) {
          await fsp.writeFile(selected.file, normalized);
          await fsp.writeFile(selected.file.replace(/\.png$/, '.jpg'), await toJpeg(normalized, 90));
          const updated: GeneratedVariant = {
            ...selected,
            critique: refinedCritique,
            localQa: refinedQa,
            iteration: selected.iteration + 1,
            refined: true,
          };
          variants[variants.findIndex((v) => v.index === selected.index)] = updated;
          selected = updated;
          iterationCount += 1;
          logger.info(`Verfeinerung ${pass + 1} übernommen (${critique.scoreTotal.toFixed(2)} -> ${refinedCritique.scoreTotal.toFixed(2)})`, {
            job_id: jobId, stage: 'refinement', model: improved.model, success: true,
          });
        } else {
          logger.info(
            `Verfeinerung ${pass + 1} verworfen – Original bleibt ` +
              `(Score ${critique.scoreTotal.toFixed(2)} -> ${refinedCritique.scoreTotal.toFixed(2)}, ` +
              `lokale QA ${qaBefore} -> ${qaAfter} bestandene Prüfungen)`,
            { job_id: jobId, stage: 'refinement', success: true },
          );
          break;
        }
      } catch (err) {
        logger.warn('Verfeinerung fehlgeschlagen – behalte die bisherige Fassung', {
          job_id: jobId, stage: 'refinement', error: (err as Error).message,
        });
        break;
      }
    }

    // ---------- 7. Thumbnail text ----------
    jobManager.setStatus(jobId, 'FINALIZING');
    let thumbnailText = opts.textOverride?.trim() || job.thumbnailText || '';
    if (!thumbnailText) {
      try {
        const res = await generateThumbnailText({ provider: textProvider, analysis: analysis!, concept: selectedConcept, profile, jobId });
        thumbnailText = res.text;
      } catch {
        thumbnailText = (selectedConcept.thumbnailText || analysis!.THUMBNAIL_TEXT_CANDIDATES[0] || 'MEHR DAHINTER').toUpperCase();
      }
    }
    thumbnailText = thumbnailText.toUpperCase();

    // ---------- 8. Composition + export ----------
    const cleanArt = await fsp.readFile(selected.file);
    const cleanArtPath = path.join(outputDir, 'CLEAN_ART.png');
    await fsp.writeFile(cleanArtPath, cleanArt);

    let finalPng: Buffer = cleanArt;
    const wantsOverlay = cfg.textMode === 'LOCAL_OVERLAY' || cfg.textMode === 'BOTH_FOR_COMPARISON';

    // The concept proposes a text area, the actual image decides. Without this
    // the headline can land straight on the subject's face.
    const preferredArea = cfg.textPosition === 'AUTO' ? selectedConcept.textArea : cfg.textPosition;
    const placement = await choosePlacement(cleanArt, preferredArea, {
      allowOverride: cfg.textPosition === 'AUTO',
    });
    logger.info(placement.reason, {
      job_id: jobId,
      stage: 'text_placement',
      success: true,
    });
    const accentHue = await pickAccentHue(cleanArt);

    if (wantsOverlay) {
      try {
        const overlay = await renderTextOverlay(cleanArt, {
          text: thumbnailText,
          position: placement.position,
          rect: placement.rect,
          accentHue,
          forceBackdrop: placement.needsBackdrop,
          font: cfg.font,
        });
        finalPng = overlay.image;
      } catch (err) {
        // Overlay failure must not trigger image regeneration (section 44).
        logger.error('Text-Overlay fehlgeschlagen – exportiere Artwork ohne Text', {
          job_id: jobId, stage: 'overlay', error: (err as Error).message, success: false,
        });
      }
    }

    const finalPngPath = path.join(outputDir, 'FINAL_THUMBNAIL.png');
    const finalJpgPath = path.join(outputDir, 'FINAL_THUMBNAIL.jpg');
    await fsp.writeFile(finalPngPath, finalPng);
    await fsp.writeFile(finalJpgPath, await toJpeg(finalPng, 92));

    if (cfg.textMode === 'BOTH_FOR_COMPARISON') {
      try {
        const aiPrompt = buildImagePrompt({
          concept: selectedConcept, analysis: analysis!, profile,
          textMode: 'AI_RENDERED', thumbnailText,
        });
        const estimate = estimateImageCost(cfg.imageModel, quality, 1, cfg.resolution);
        costTracker.assertWithinBudget(jobId, estimate);
        const [aiText] = await imageProvider.generate({ prompt: aiPrompt, size: cfg.resolution, quality, n: 1, jobId });
        costTracker.record({
          jobId, kind: 'image', model: aiText.model, quality: aiText.quality, size: aiText.size,
          count: 1, estimatedUsd: estimateImageCost(aiText.model, aiText.quality, 1, aiText.size),
        });
        await fsp.writeFile(path.join(outputDir, 'FINAL_THUMBNAIL_AI_TEXT.png'), await normalizeToTarget(aiText.data, targetSize));
      } catch (err) {
        logger.warn('AI-Text-Variante konnte nicht erzeugt werden', { job_id: jobId, stage: 'ai_text', error: (err as Error).message });
      }
    }

    // ---------- 9. QA + mobile preview ----------
    const mobile = await makeMobilePreview(finalPng, 320);
    const mobilePath = path.join(outputDir, 'MOBILE_PREVIEW.jpg');
    await fsp.writeFile(mobilePath, mobile);

    const qa = await runQualityAssurance({
      finalImage: finalPng,
      cleanArt,
      targetSize: cfg.resolution,
      expectText: wantsOverlay,
      textPosition: placement.position,
      mobilePreviewPath: mobilePath,
    });

    if (modeSettings.critique === 'full') {
      try {
        const finalCheck = await finalCompositionCheck({
          provider: textProvider, image: finalPng, jobId, thumbnailText,
          videoTitle: analysis!.VIDEO_TITLE,
        });
        qa.checks.push({
          name: 'final_composition',
          passed: finalCheck.approved,
          detail: [finalCheck.notes, ...finalCheck.issues].filter(Boolean).join(' | ') || 'KI-Prüfung des fertigen Thumbnails.',
        });
        qa.passed = qa.checks.every((c) => c.passed);
      } catch {
        /* optional check */
      }
    }

    // ---------- 10. Metadata ----------
    const finalScore = selected.critique?.scoreTotal ?? selectedConcept.scoreTotal ?? computeScoreTotal(selectedConcept.score!);
    const metadata: ThumbnailAnalysisFile = {
      source_file: job.sourceFile,
      processing_timestamp: nowIso(),
      video_title: analysis!.VIDEO_TITLE,
      thumbnail_hook: analysis!.PRIMARY_HOOK,
      thumbnail_text: thumbnailText,
      concept_summary: `${selectedConcept.label}: ${selectedConcept.idea}`,
      selected_variant: selected.index,
      selection_reason: selection.reason,
      candidates_generated: variants.length,
      candidates_rejected: rejectedCount,
      requested_model: selected.requested?.model ?? cfg.imageModel,
      requested_quality: requestedQuality.quality,
      requested_size: requestSize,
      quality_source: requestedQuality.source,
      premium_mode: modeSettings.premium,
      quality_degradations: allDegradations,
      visual_ranking: ranking ?? null,
      critique_source: selected.critique?.source ?? 'none',
      image_model: selected.model,
      analysis_model: analysisModelUsed,
      image_provider: cfg.testMode ? 'mock' : cfg.imageProvider,
      quality: selected.quality,
      size: selected.size,
      generation_count: variants.length + (iterationCount > 1 ? 1 : 0),
      iteration_count: iterationCount,
      final_score: finalScore,
      estimated_cost_usd: costTracker.jobTotal(jobId),
      cost_is_estimate: true,
      test_mode: cfg.testMode,
      // Explizite Kennzeichnung: im TEST_MODE ist die Bildfläche ein Platzhalter
      // und darf niemals als fertiges Thumbnail veröffentlicht werden.
      artwork_is_placeholder: cfg.testMode,
      publishable: !cfg.testMode,
      not_publishable_reason: cfg.testMode
        ? 'TEST_MODE: Die Bildfläche ist synthetische Platzhalter-Grafik, kein generiertes Motiv.'
        : null,
      text_placement: {
        position: placement.position,
        reason: placement.reason,
        focal_overlap: placement.scores.find((x) => x.position === placement.position)?.focalOverlap ?? null,
        backdrop_forced: placement.needsBackdrop,
        candidates: placement.scores,
      },
      qa,
      script_analysis: analysis!,
      concepts,
      variants: variants.map((v) => ({ ...v })),
      error_information: null,
    };
    await fsp.writeFile(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), JSON.stringify(metadata, null, 2));
    if (cfg.testMode) {
      // Unübersehbare Markierung im Ausgabeordner: ein Platzhalter darf nicht
      // versehentlich als fertiges Thumbnail hochgeladen werden.
      await fsp.writeFile(
        path.join(outputDir, 'NICHT_VEROEFFENTLICHEN.txt'),
        'TEST_MODE-Lauf.\n\n' +
          'Die Bildfläche ist synthetische Platzhalter-Grafik, kein generiertes Motiv.\n' +
          'Textsatz, Platzierung und Export sind echt, das Bild ist es nicht.\n' +
          'Für ein veröffentlichbares Thumbnail: TEST_MODE=false und gültigen OPENAI_API_KEY setzen.\n',
        'utf8',
      );
    }
    await fsp.writeFile(
      path.join(outputDir, 'PROMPT_USED.txt'),
      formatPromptFile({
        prompt: selected.prompt, concept: selectedConcept, model: selected.model,
        quality: selected.quality, size: selected.size, textMode: cfg.textMode, thumbnailText,
      }),
    );

    // ---------- 11. Archive the source script ----------
    try {
      await fsp.mkdir(cfg.archiveFolder, { recursive: true });
      const archiveTarget = path.join(cfg.archiveFolder, `${slug}${path.extname(job.sourceFile)}`);
      await fsp.copyFile(job.sourceFile, archiveTarget);
    } catch (err) {
      logger.warn('Skript konnte nicht archiviert werden', { job_id: jobId, stage: 'archive', error: (err as Error).message });
    }

    jobManager.markProcessed(job.hash, jobId, job.fileName, outputDir);
    const finished = jobManager.setStatus(jobId, 'COMPLETED', {
      variants,
      selectedVariant: selected.index,
      selectionReason: selection.reason,
      ranking,
      rejectedCount,
      generation: {
        requestedModel: selected.requested?.model ?? cfg.imageModel,
        actualModel: selected.model,
        requestedQuality: requestedQuality.quality,
        actualQuality: selected.quality,
        qualitySource: requestedQuality.source,
        requestedSize: requestSize,
        actualSize: selected.size,
        premium: modeSettings.premium,
        degradations: allDegradations,
        provider: cfg.testMode ? 'mock' : cfg.imageProvider,
        testMode: cfg.testMode,
      },
      thumbnailText,
      thumbnailHook: analysis!.PRIMARY_HOOK,
      conceptSummary: metadata.concept_summary,
      finalScore,
      iterationCount,
      generationCount: metadata.generation_count,
      estimatedCostUsd: costTracker.jobTotal(jobId),
      qa,
      error: undefined,
    });
    logger.info('Job abgeschlossen', {
      job_id: jobId, stage: 'completed', file: job.fileName,
      duration_ms: Date.now() - startedAt, success: true,
    });
    return finished;
  } catch (err) {
    const error = {
      message: (err as Error)?.message ?? String(err),
      stage: jobManager.get(jobId)?.status ?? 'unknown',
      code: (err as { code?: string })?.code,
      permanent: !isTransient(err),
      at: nowIso(),
    };
    logger.error(`Job fehlgeschlagen: ${error.message}`, {
      job_id: jobId, stage: error.stage, error: error.message, success: false,
    });

    // Preserve the failing script and a failure report — never lose the input.
    try {
      const failedDir = getConfig().failedFolder;
      await fsp.mkdir(failedDir, { recursive: true });
      const j = jobManager.get(jobId);
      if (j) {
        await fsp.writeFile(
          path.join(failedDir, `${sanitizeName(path.basename(j.fileName, path.extname(j.fileName)))}_${jobId}.json`),
          JSON.stringify({ job: { ...j, analysis: undefined }, error }, null, 2),
        );
        if (fs.existsSync(j.sourceFile)) {
          await fsp.copyFile(j.sourceFile, path.join(failedDir, j.fileName)).catch(() => undefined);
        }
      }
    } catch {
      /* best effort */
    }

    return jobManager.setStatus(jobId, 'FAILED', { error, estimatedCostUsd: costTracker.jobTotal(jobId) });
  }
}
