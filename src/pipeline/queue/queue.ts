import { EventEmitter } from 'node:events';
import { logger } from '../../utils/logger.js';

export interface QueueTask {
  id: string;
  label: string;
  run: () => Promise<void>;
}

/**
 * Serial job queue — guarantees that the same file is never processed twice
 * in parallel and keeps API concurrency (and cost) predictable.
 */
export class JobQueue extends EventEmitter {
  private tasks: QueueTask[] = [];
  private running = false;
  private currentId: string | null = null;

  get current(): string | null {
    return this.currentId;
  }

  get size(): number {
    return this.tasks.length;
  }

  get pendingIds(): string[] {
    return this.tasks.map((t) => t.id);
  }

  has(id: string): boolean {
    return this.currentId === id || this.tasks.some((t) => t.id === id);
  }

  push(task: QueueTask): boolean {
    if (this.has(task.id)) return false;
    this.tasks.push(task);
    this.emit('change');
    void this.drain();
    return true;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.tasks.length) {
        const task = this.tasks.shift()!;
        this.currentId = task.id;
        this.emit('change');
        try {
          await task.run();
        } catch (err) {
          // Individual failures must never kill the queue (section 28).
          logger.error(`Queue-Task fehlgeschlagen: ${task.label}`, {
            job_id: task.id,
            stage: 'queue',
            error: (err as Error)?.message,
            success: false,
          });
        }
        this.currentId = null;
        this.emit('change');
      }
    } finally {
      this.running = false;
    }
  }
}

export const jobQueue = new JobQueue();
