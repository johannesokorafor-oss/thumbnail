import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getChannelProfile, getConfig, qualityModeSettings } from '../config/index.js';
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
import { buildImagePrompt, formatPromptFile } from '../ai/prompting/promptBuilder.js';
import { critiqueVariant, extractReferenceStyle, mobileReadabilityCheck } from '../ai/critique/imageCritic.js';
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
  const quality = cfg.testMode ? cfg.quality : modeSettings.quality;
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
    const keepExisting = opts.onlyVariant !== undefined ? job.variants ?? [] : [];

    for (let i = 0; i < chosenConcepts.length; i++) {
      const index = i + 1;
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
        size: cfg.resolution,
        quality,
        n: 1,
        outputFormat: 'png',
        jobId,
      });
      costTracker.record({
        jobId, kind: 'image', model: image.model, quality: image.quality,
        size: image.size, count: 1, estimatedUsd: estimateImageCost(image.model, image.quality, 1, image.size),
      });

      const normalized = await normalizeToTarget(image.data, targetSize);
      const file = path.join(outputDir, `VARIANT_${String(index).padStart(2, '0')}.png`);
      await fsp.writeFile(file, normalized);
      await fsp.writeFile(file.replace(/\.png$/, '.jpg'), await toJpeg(normalized, 90));

      variants.push({
        index, conceptId: concept.id, file, prompt,
        model: image.model, quality: image.quality, size: `${targetSize.width}x${targetSize.height}`,
        iteration: 1,
      });
      logger.info(`Variante ${index} generiert`, {
        job_id: jobId, stage: 'image_generation', model: image.model,
        duration_ms: Date.now() - t0, success: true,
      });
      job = jobManager.update(jobId, {
        variants: [...variants],
        generationCount: (job.generationCount ?? 0) + 1,
        estimatedCostUsd: costTracker.jobTotal(jobId),
      });
    }

    // ---------- 4. Visual critique ----------
    jobManager.setStatus(jobId, 'EVALUATING');
    for (const variant of variants) {
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
    job = jobManager.update(jobId, { variants: [...variants], estimatedCostUsd: costTracker.jobTotal(jobId) });

    // ---------- 5. Selection ----------
    const summaries = variants.map((v) => {
      const concept = chosenConcepts.find((c) => c.id === v.conceptId);
      return {
        index: v.index,
        concept: `${concept?.label ?? v.conceptId}: ${concept?.idea ?? ''}`,
        critique: v.critique?.summary ?? 'keine Bewertung verfügbar',
        scoreTotal: v.critique?.scoreTotal ?? concept?.scoreTotal ?? 0,
      };
    });
    let selection: { selectedIndex: number; reason: string };
    try {
      selection = await selectBestVariant({ provider: textProvider, jobId, analysis: analysis!, summaries });
    } catch {
      const best = [...summaries].sort((a, b) => b.scoreTotal - a.scoreTotal)[0];
      selection = { selectedIndex: best.index, reason: 'Automatische Auswahl über den technischen Design-Score.' };
    }
    let selected = variants.find((v) => v.index === selection.selectedIndex) ?? variants[0];
    const selectedConcept = chosenConcepts.find((c) => c.id === selected.conceptId) ?? chosenConcepts[0];

    // ---------- 6. Optional targeted second pass (MAX mode) ----------
    let iterationCount = 1;
    const critique = selected.critique;
    const needsImprovement =
      modeSettings.allowSecondPass &&
      critique &&
      (critique.scoreTotal < 8 || critique.overloaded || !critique.textAreaSufficient || critique.artifacts.length > 0);

    if (needsImprovement && critique) {
      try {
        const improvedPrompt = buildImagePrompt({
          concept: selectedConcept,
          analysis: analysis!,
          profile,
          textMode: cfg.textMode,
          thumbnailText: selectedConcept.thumbnailText,
          improvement: critique.improvementPrompt,
        });
        const estimate = estimateImageCost(cfg.imageModel, quality, 1, cfg.resolution);
        costTracker.assertWithinBudget(jobId, estimate);
        const [improved] = await imageProvider.generate({
          prompt: improvedPrompt, size: cfg.resolution, quality, n: 1, outputFormat: 'png', jobId,
        });
        costTracker.record({
          jobId, kind: 'image', model: improved.model, quality: improved.quality,
          size: improved.size, count: 1, estimatedUsd: estimateImageCost(improved.model, improved.quality, 1, improved.size),
        });
        const normalized = await normalizeToTarget(improved.data, targetSize);
        await fsp.writeFile(selected.file, normalized);
        await fsp.writeFile(selected.file.replace(/\.png$/, '.jpg'), await toJpeg(normalized, 90));
        selected = { ...selected, prompt: improvedPrompt, iteration: 2 };
        variants[variants.findIndex((v) => v.index === selected.index)] = selected;
        iterationCount = 2;
        logger.info('Gezielte zweite Generierung für die Favoritenvariante abgeschlossen', {
          job_id: jobId, stage: 'iteration', model: improved.model, success: true,
        });
      } catch (err) {
        logger.warn('Zweite Generierung fehlgeschlagen – behalte die erste Fassung', {
          job_id: jobId, stage: 'iteration', error: (err as Error).message,
        });
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
    if (wantsOverlay) {
      try {
        const overlay = await renderTextOverlay(cleanArt, {
          text: thumbnailText,
          position: cfg.textPosition === 'AUTO' ? selectedConcept.textArea : cfg.textPosition,
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
      textPosition: cfg.textPosition === 'AUTO' ? selectedConcept.textArea : cfg.textPosition,
      mobilePreviewPath: mobilePath,
    });

    if (modeSettings.critique === 'full') {
      try {
        const mobileCheck = await mobileReadabilityCheck({ provider: textProvider, imagePath: mobilePath, jobId, thumbnailText });
        qa.checks.push({
          name: 'mobile_readability',
          passed: mobileCheck.textReadable && mobileCheck.subjectRecognizable && mobileCheck.compositionClear,
          detail: mobileCheck.notes || 'KI-Prüfung der 320px-Vorschau.',
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
      qa,
      script_analysis: analysis!,
      concepts,
      variants: variants.map((v) => ({ ...v })),
      error_information: null,
    };
    await fsp.writeFile(path.join(outputDir, 'THUMBNAIL_ANALYSIS.json'), JSON.stringify(metadata, null, 2));
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
