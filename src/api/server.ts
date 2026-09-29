import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import {
  ensureWorkspaceFolders,
  getChannelProfile,
  getConfig,
  saveChannelProfile,
  updateConfig,
} from '../config/index.js';
import { jobManager } from '../pipeline/jobs/jobManager.js';
import { jobQueue } from '../pipeline/queue/queue.js';
import { orchestrator } from '../pipeline/orchestrator.js';
import { costTracker } from '../pipeline/costTracker.js';
import { logger } from '../utils/logger.js';
import { getImageProvider, getTextProvider } from '../ai/providers/registry.js';
import { clearModelCache } from '../ai/providers/openai/client.js';
import type { AppConfig, ChannelProfile } from '../types/index.js';

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // ---------- Status ----------
  app.get('/api/status', async (_req, res) => {
    const cfg = getConfig();
    const imageProvider = getImageProvider();
    let apiReachable = false;
    try {
      apiReachable = await imageProvider.isAvailable();
    } catch {
      apiReachable = false;
    }
    const jobs = jobManager.all();
    res.json({
      testMode: cfg.testMode,
      apiReachable,
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      imageProvider: cfg.testMode ? 'mock' : cfg.imageProvider,
      models: {
        analysis: cfg.testMode ? 'mock-analysis-model' : cfg.analysisModel,
        analysisFallback: cfg.analysisModelFallback,
        image: cfg.testMode ? 'mock-image-model' : cfg.imageModel,
        imageFallback: cfg.fallbackImageModel,
      },
      qualityMode: cfg.qualityMode,
      textMode: cfg.textMode,
      folders: {
        input: cfg.inputFolder,
        output: cfg.outputFolder,
        archive: cfg.archiveFolder,
        failed: cfg.failedFolder,
        reference: cfg.referenceFolder,
      },
      watcher: { running: orchestrator.watcher.isRunning, folder: orchestrator.watcher.watchedFolder },
      queue: { current: jobQueue.current, pending: jobQueue.pendingIds, size: jobQueue.size },
      counts: {
        total: jobs.length,
        completed: jobs.filter((j) => j.status === 'COMPLETED').length,
        failed: jobs.filter((j) => j.status === 'FAILED').length,
      },
      cost: {
        today: costTracker.dayTotal(),
        session: costTracker.sessionTotal(),
        maxPerJob: cfg.maxCostPerJob,
        maxPerDay: cfg.maxDailyCost,
        isEstimate: true,
      },
    });
  });

  // ---------- Jobs ----------
  app.get('/api/jobs', (_req, res) => res.json(jobManager.all()));
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobManager.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
    res.json(job);
  });

  app.post('/api/jobs/:id/regenerate', (req, res) => {
    const { variant, text, resumeFrom } = req.body ?? {};
    const ok = orchestrator.rerun(req.params.id, {
      onlyVariant: typeof variant === 'number' ? variant : undefined,
      textOverride: typeof text === 'string' ? text : undefined,
      resumeFrom,
    });
    res.json({ ok });
  });

  app.post('/api/jobs/:id/text', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Text fehlt' });
    const ok = orchestrator.rerun(req.params.id, { textOverride: text, resumeFrom: 'overlay' });
    res.json({ ok });
  });

  app.post('/api/jobs/:id/concept', (req, res) => {
    const conceptOverride = req.body?.concept ?? {};
    const ok = orchestrator.rerun(req.params.id, { conceptOverride, resumeFrom: 'generation' });
    res.json({ ok });
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const job = jobManager.get(req.params.id);
    if (job) {
      jobManager.forget(job.hash);
      jobManager.remove(job.id);
    }
    res.json({ ok: true });
  });

  app.post('/api/jobs/clear-completed', (_req, res) => {
    jobManager.clearCompleted();
    res.json({ ok: true });
  });

  // ---------- Ingestion ----------
  app.post('/api/scan', async (_req, res) => {
    const queued = await orchestrator.scanInputFolder();
    res.json({ queued });
  });

  app.post('/api/process', (req, res) => {
    const file = String(req.body?.file ?? '');
    const force = Boolean(req.body?.force);
    if (!file || !fs.existsSync(file)) return res.status(400).json({ error: 'Datei nicht gefunden' });
    res.json(orchestrator.enqueueFile(file, force));
  });

  app.get('/api/input-files', async (_req, res) => {
    const cfg = getConfig();
    try {
      const files = await orchestrator.watcher.scanOnce(cfg.inputFolder);
      const detailed = await Promise.all(
        files.map(async (f) => {
          const st = await fsp.stat(f);
          return { path: f, name: path.basename(f), size: st.size, modified: st.mtime.toISOString() };
        }),
      );
      res.json(detailed);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------- Settings ----------
  app.get('/api/settings', (_req, res) => {
    const cfg = getConfig();
    res.json({ config: cfg, channelProfile: getChannelProfile() });
  });

  app.put('/api/settings', async (req, res) => {
    const patch = (req.body?.config ?? {}) as Partial<AppConfig>;
    const profile = req.body?.channelProfile as ChannelProfile | undefined;
    const next = updateConfig(patch);
    if (profile) saveChannelProfile(profile);
    ensureWorkspaceFolders(next);
    clearModelCache();
    await orchestrator.restartWatcher();
    logger.info('Einstellungen aktualisiert', { stage: 'settings' });
    res.json({ config: next, channelProfile: getChannelProfile() });
  });

  // ---------- Costs & logs ----------
  app.get('/api/costs', (_req, res) => {
    const cfg = getConfig();
    res.json({
      entries: costTracker.entries(200),
      today: costTracker.dayTotal(),
      session: costTracker.sessionTotal(),
      limits: { perJob: cfg.maxCostPerJob, perDay: cfg.maxDailyCost },
      isEstimate: true,
    });
  });

  app.get('/api/logs', (req, res) => {
    res.json(logger.recent(Number(req.query.limit ?? 200)));
  });

  // ---------- Files ----------
  app.get('/api/file', (req, res) => {
    const file = String(req.query.path ?? '');
    const cfg = getConfig();
    const allowedRoots = [cfg.outputFolder, cfg.archiveFolder, cfg.failedFolder, cfg.referenceFolder, cfg.inputFolder];
    const resolved = path.resolve(file);
    if (!allowedRoots.some((root) => resolved.startsWith(path.resolve(root)))) {
      return res.status(403).json({ error: 'Pfad außerhalb der konfigurierten Ordner' });
    }
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Datei nicht gefunden' });
    res.sendFile(resolved);
  });

  app.post('/api/open-folder', (req, res) => {
    const target = String(req.body?.path ?? getConfig().outputFolder);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Ordner nicht gefunden' });
    const cmd =
      process.platform === 'win32' ? `explorer "${target}"` :
      process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
    exec(cmd, () => undefined);
    res.json({ ok: true, path: target });
  });

  // ---------- Live events (SSE) ----------
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('hello', { at: new Date().toISOString() });

    const onJob = (job: unknown) => send('job', job);
    const onJobs = () => send('jobs', jobManager.all());
    const onLog = (record: unknown) => send('log', record);
    const onQueue = () => send('queue', { current: jobQueue.current, pending: jobQueue.pendingIds });

    jobManager.on('job', onJob);
    jobManager.on('jobs', onJobs);
    logger.on('log', onLog);
    jobQueue.on('change', onQueue);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(ping);
      jobManager.off('job', onJob);
      jobManager.off('jobs', onJobs);
      logger.off('log', onLog);
      jobQueue.off('change', onQueue);
    });
  });

  // ---------- Static UI (production build) ----------
  const uiDist = path.resolve(process.cwd(), 'ui/dist');
  if (fs.existsSync(uiDist)) {
    app.use(express.static(uiDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(uiDist, 'index.html')));
  }

  return app;
}

export async function startServer(): Promise<void> {
  const cfg = getConfig();
  logger.level = cfg.logLevel as 'info';
  ensureWorkspaceFolders(cfg);
  await orchestrator.start();
  const app = createServer();
  app.listen(cfg.port, '0.0.0.0', () => {
    logger.info(`Thumbnail Studio läuft auf http://localhost:${cfg.port}`, { stage: 'startup' });
    if (cfg.testMode) logger.warn('TEST_MODE ist aktiv – es werden keine echten API-Kosten erzeugt.', { stage: 'startup' });
  });
  void getTextProvider();
}
