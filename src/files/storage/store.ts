import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_DIR } from '../../config/index.js';
import type { CostEntry, Job } from '../../types/index.js';

/** Tiny atomic JSON store — local-first, no database server required. */
export class JsonStore<T> {
  private file: string;
  private data: T;

  constructor(name: string, initial: T) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    this.file = path.join(RUNTIME_DIR, `${name}.json`);
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as T;
      } catch {
        this.data = initial;
      }
    } else {
      this.data = initial;
      this.flush();
    }
  }

  get(): T {
    return this.data;
  }

  set(next: T): void {
    this.data = next;
    this.flush();
  }

  update(fn: (current: T) => T): T {
    this.data = fn(this.data);
    this.flush();
    return this.data;
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export interface ProcessedRecord {
  hash: string;
  fileName: string;
  jobId: string;
  at: string;
  outputDir?: string;
}

export const jobStore = new JsonStore<Record<string, Job>>('jobs', {});
export const processedStore = new JsonStore<Record<string, ProcessedRecord>>('processed', {});
export const costStore = new JsonStore<CostEntry[]>('costs', []);
