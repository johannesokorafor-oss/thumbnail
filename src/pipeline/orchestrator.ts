import { ensureWorkspaceFolders, getConfig } from '../config/index.js';
import { ScriptWatcher } from '../files/watcher/index.js';
import { jobQueue } from './queue/queue.js';
import { jobManager } from './jobs/jobManager.js';
import { registerScript, runPipeline, type RunOptions } from './pipeline.js';
import { logger } from '../utils/logger.js';

/** Wires watcher → queue → pipeline and exposes manual controls for the UI. */
export class Orchestrator {
  readonly watcher = new ScriptWatcher();

  async start(): Promise<void> {
    const cfg = getConfig();
    ensureWorkspaceFolders(cfg);
    this.watcher.removeAllListeners('script');
    this.watcher.on('script', (filePath: string) => this.enqueueFile(filePath));
    if (cfg.watcherEnabled) {
      await this.watcher.start(cfg.inputFolder);
    }
  }

  async restartWatcher(): Promise<void> {
    const cfg = getConfig();
    ensureWorkspaceFolders(cfg);
    if (cfg.watcherEnabled) await this.watcher.start(cfg.inputFolder);
    else await this.watcher.stop();
  }

  enqueueFile(filePath: string, force = false): { jobId?: string; skipped?: string } {
    try {
      const { job, skipped } = registerScript(filePath, force);
      if (skipped) return { skipped };
      if (!job) return {};
      jobManager.setStatus(job.id, 'QUEUED');
      jobQueue.push({ id: job.id, label: job.fileName, run: () => runPipeline(job.id).then(() => undefined) });
      return { jobId: job.id };
    } catch (err) {
      logger.error(`Datei konnte nicht eingereiht werden: ${filePath}`, {
        stage: 'ingestion', error: (err as Error).message, success: false,
      });
      return {};
    }
  }

  /** Re-run an existing job, optionally only part of the pipeline. */
  rerun(jobId: string, opts: RunOptions = {}): boolean {
    const job = jobManager.get(jobId);
    if (!job) return false;
    if (jobQueue.has(jobId)) return false;
    jobManager.setStatus(jobId, 'QUEUED');
    jobQueue.push({ id: jobId, label: `${job.fileName} (erneut)`, run: () => runPipeline(jobId, opts).then(() => undefined) });
    return true;
  }

  async scanInputFolder(): Promise<number> {
    const files = await this.watcher.scanOnce(getConfig().inputFolder);
    let queued = 0;
    for (const f of files) {
      const res = this.enqueueFile(f);
      if (res.jobId) queued++;
    }
    return queued;
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
  }
}

export const orchestrator = new Orchestrator();
