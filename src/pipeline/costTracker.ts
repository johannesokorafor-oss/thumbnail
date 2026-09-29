import type { CostEntry } from '../types/index.js';
import { costStore } from '../files/storage/store.js';
import { CostLimitError } from '../utils/retry.js';
import { getConfig } from '../config/index.js';

/**
 * Cost ESTIMATES, calibrated against the published OpenAI image pricing
 * (image output tokens are billed at $30 per 1M tokens for both 2.5 models).
 *
 * Token counts below are the documented values for 1024x1024 and 1536x1024;
 * the per-megapixel rate is derived from them and then scaled to the actual
 * requested size. Everything produced here is flagged `estimated: true` —
 * the real invoice is whatever OpenAI charges.
 */
export const IMAGE_TOKEN_PRICE_PER_MILLION = 30;

/** Documented output tokens per megapixel, derived from the published tables. */
const TOKENS_PER_MEGAPIXEL: Record<string, number> = {
  // 1024x1024 = 1.049 MP -> max 7024 tok, xhigh 3122 tok, high 1413 tok
  max: 6_696,
  xhigh: 2_976,
  high: 1_347,
  medium: 674,
  low: 337,
  auto: 2_976,
};

/** Relative token cost per model (flare is the smaller, cheaper model). */
const MODEL_TOKEN_FACTOR: Record<string, number> = {
  'gpt-image-2.5-sunburst': 1,
  'gpt-image-2.5-flare': 0.5,
  default: 1,
};

/** Rough per-call estimate for text/reasoning models (USD). */
export const ANALYSIS_CALL_ESTIMATE = 0.05;

export function estimateImageCost(model: string, quality: string, count: number, size = '2560x1440'): number {
  const tokensPerMp = TOKENS_PER_MEGAPIXEL[quality] ?? TOKENS_PER_MEGAPIXEL.high;
  const factor = MODEL_TOKEN_FACTOR[model] ?? MODEL_TOKEN_FACTOR.default;
  const [w, h] = size.split('x').map(Number);
  const megapixels = ((w || 2560) * (h || 1440)) / 1_000_000;
  const tokens = tokensPerMp * megapixels * factor;
  return Number(((tokens / 1_000_000) * IMAGE_TOKEN_PRICE_PER_MILLION * count).toFixed(4));
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
