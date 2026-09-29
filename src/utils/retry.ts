import { logger } from './logger.js';

export class PermanentError extends Error {
  code: string;
  constructor(message: string, code = 'PERMANENT') {
    super(message);
    this.name = 'PermanentError';
    this.code = code;
  }
}

export class CostLimitError extends PermanentError {
  constructor(message: string) {
    super(message, 'COST_LIMIT');
    this.name = 'CostLimitError';
  }
}

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 422]);

/** Decide whether retrying makes sense at all (section 29). */
export function isTransient(error: unknown): boolean {
  if (error instanceof PermanentError) return false;
  const e = error as { status?: number; code?: string; message?: string };
  if (typeof e?.status === 'number') {
    if (PERMANENT_STATUS.has(e.status)) return false;
    if (TRANSIENT_STATUS.has(e.status)) return true;
  }
  const code = String(e?.code ?? '');
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE'].includes(code)) return true;
  const msg = String(e?.message ?? '').toLowerCase();
  if (/insufficient_quota|invalid api key|invalid_api_key|billing/.test(msg)) return false;
  if (/timeout|rate limit|temporarily|overloaded|socket hang up|network/.test(msg)) return true;
  return false;
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  jobId?: string;
  /** Injected for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter; only for transient failures. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 800, maxDelayMs = 15_000, label = 'operation', jobId, sleep = defaultSleep } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isTransient(err)) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + Math.floor(Math.random() * 250);
      logger.warn(`${label} failed, retry ${attempt + 1}/${retries} in ${delay}ms`, {
        job_id: jobId,
        stage: label,
        error: (err as Error)?.message,
        success: false,
      });
      await sleep(delay);
    }
  }
  throw lastError;
}
