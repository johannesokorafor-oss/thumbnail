import { EventEmitter } from 'node:events';
import type { Job, JobStatus } from '../../types/index.js';
import { jobStore, processedStore } from '../../files/storage/store.js';
import { logger } from '../../utils/logger.js';

export const STAGE_LABELS: Record<JobStatus, string> = {
  DETECTED: 'Skript erkannt',
  QUEUED: 'In der Warteschlange',
  ANALYZING: 'Analyse läuft',
  DESIGNING: 'Thumbnail-Konzepte werden entwickelt',
  GENERATING: 'Varianten werden generiert',
  EVALUATING: 'Varianten werden bewertet',
  FINALIZING: 'Finalisierung läuft',
  COMPLETED: 'Fertig',
  FAILED: 'Fehlgeschlagen',
  REJECTED: 'Verworfen (kein Kandidat gut genug)',
  SKIPPED_DUPLICATE: 'Übersprungen (bereits verarbeitet)',
  WAITING: 'Wartet (Provider nicht erreichbar)',
};

/** Central job registry with change events for the UI (SSE). */
export class JobManager extends EventEmitter {
  create(job: Job): Job {
    jobStore.update((all) => ({ ...all, [job.id]: job }));
    this.emit('job', job);
    return job;
  }

  get(id: string): Job | undefined {
    return jobStore.get()[id];
  }

  all(): Job[] {
    return Object.values(jobStore.get()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  update(id: string, patch: Partial<Job>): Job {
    const current = jobStore.get()[id];
    if (!current) throw new Error(`Job ${id} nicht gefunden`);
    const next: Job = { ...current, ...patch, updatedAt: new Date().toISOString() };
    jobStore.update((all) => ({ ...all, [id]: next }));
    this.emit('job', next);
    return next;
  }

  setStatus(id: string, status: JobStatus, extra: Partial<Job> = {}): Job {
    const current = this.get(id);
    const steps = [...(current?.steps ?? []), { stage: status, label: STAGE_LABELS[status], at: new Date().toISOString() }];
    logger.info(STAGE_LABELS[status], { job_id: id, stage: status, file: current?.fileName });
    return this.update(id, { status, steps, ...extra });
  }

  /** Duplicate detection via SHA-256 + filename (section 39). */
  findByHash(hash: string) {
    return processedStore.get()[hash];
  }

  markProcessed(hash: string, jobId: string, fileName: string, outputDir?: string): void {
    processedStore.update((all) => ({
      ...all,
      [hash]: { hash, jobId, fileName, at: new Date().toISOString(), outputDir },
    }));
  }

  forget(hash: string): void {
    processedStore.update((all) => {
      const next = { ...all };
      delete next[hash];
      return next;
    });
  }

  remove(id: string): void {
    jobStore.update((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    this.emit('jobs');
  }

  clearCompleted(): void {
    jobStore.update((all) =>
      Object.fromEntries(Object.entries(all).filter(([, j]) => j.status !== 'COMPLETED')),
    );
    this.emit('jobs');
  }
}

export const jobManager = new JobManager();
