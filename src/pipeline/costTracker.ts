import type { CostEntry } from '../types/index.js';
import { costStore } from '../files/storage/store.js';
import { CostLimitError } from '../utils/retry.js';
import { getConfig } from '../config/index.js';

/**
 * Pricing table for cost ESTIMATES only. The real invoice is whatever the
 * provider charges — every number produced here is flagged `estimated: true`.
 */
export const IMAGE_PRICE_TABLE: Record<string, Record<string, number>> = {
  'gpt-image-2.5-sunburst': { max: 0.25, xhigh: 0.17, high: 0.12, medium: 0.06, low: 0.03 },
  'gpt-image-2.5-flare': { max: 0.12, xhigh: 0.09, high: 0.06, medium: 0.03, low: 0.02 },
  default: { max: 0.2, xhigh: 0.15, high: 0.1, medium: 0.05, low: 0.02 },
};

/** Rough per-call estimate for text/reasoning models (USD). */
export const ANALYSIS_CALL_ESTIMATE = 0.05;

export function estimateImageCost(model: string, quality: string, count: number, size = '2560x1440'): number {
  const table = IMAGE_PRICE_TABLE[model] ?? IMAGE_PRICE_TABLE.default;
  const base = table[quality] ?? table.high ?? 0.1;
  const [w, h] = size.split('x').map(Number);
  const pixels = (w || 1536) * (h || 1024);
  const scale = Math.max(0.6, Math.min(2.2, pixels / (1536 * 1024)));
  return Number((base * scale * count).toFixed(4));
}

export class CostTracker {
  /** Per-job accumulation, reset when a job starts. */
  private jobTotals = new Map<string, number>();

  record(entry: Omit<CostEntry, 'timestamp' | 'estimated'>): CostEntry {
    const full: CostEntry = { ...entry, timestamp: new Date().toISOString(), estimated: true };
    costStore.update((list) => [...list, full].slice(-5000));
    this.jobTotals.set(entry.jobId, (this.jobTotals.get(entry.jobId) ?? 0) + entry.estimatedUsd);
    return full;
  }

  jobTotal(jobId: string): number {
    if (this.jobTotals.has(jobId)) return Number(this.jobTotals.get(jobId)!.toFixed(4));
    return Number(
      costStore
        .get()
        .filter((c) => c.jobId === jobId)
        .reduce((a, c) => a + c.estimatedUsd, 0)
        .toFixed(4),
    );
  }

  dayTotal(date = new Date()): number {
    const day = date.toISOString().slice(0, 10);
    return Number(
      costStore
        .get()
        .filter((c) => c.timestamp.startsWith(day))
        .reduce((a, c) => a + c.estimatedUsd, 0)
        .toFixed(4),
    );
  }

  sessionTotal(): number {
    return Number([...this.jobTotals.values()].reduce((a, b) => a + b, 0).toFixed(4));
  }

  resetJob(jobId: string): void {
    this.jobTotals.set(jobId, 0);
  }

  /** Throws a permanent CostLimitError when a configured budget would be exceeded. */
  assertWithinBudget(jobId: string, upcomingUsd: number): void {
    const cfg = getConfig();
    const job = this.jobTotal(jobId) + upcomingUsd;
    if (cfg.maxCostPerJob > 0 && job > cfg.maxCostPerJob) {
      throw new CostLimitError(
        `Kostenlimit pro Job erreicht (geschätzt $${job.toFixed(2)} > Limit $${cfg.maxCostPerJob.toFixed(2)}).`,
      );
    }
    const day = this.dayTotal() + upcomingUsd;
    if (cfg.maxDailyCost > 0 && day > cfg.maxDailyCost) {
      throw new CostLimitError(
        `Tageskostenlimit erreicht (geschätzt $${day.toFixed(2)} > Limit $${cfg.maxDailyCost.toFixed(2)}).`,
      );
    }
  }

  entries(limit = 200): CostEntry[] {
    return costStore.get().slice(-limit);
  }
}

export const costTracker = new CostTracker();
