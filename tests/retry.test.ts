import { describe, expect, it, vi } from 'vitest';
import { PermanentError, isTransient, withRetry } from '../src/utils/retry.js';

const nosleep = async () => undefined;

describe('Retry-System', () => {
  it('erkennt transiente Fehler', () => {
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 500 })).toBe(true);
    expect(isTransient({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransient({ status: 401 })).toBe(false);
    expect(isTransient(new PermanentError('nope'))).toBe(false);
    expect(isTransient(new Error('insufficient_quota'))).toBe(false);
  });

  it('wiederholt transiente Fehler exponentiell', async () => {
    const fn = vi.fn(async (attempt: number) => {
      if (attempt < 2) throw { status: 503, message: 'overloaded' };
      return 'ok';
    });
    await expect(withRetry(fn, { retries: 3, sleep: nosleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('wiederholt permanente Fehler nicht', async () => {
    const fn = vi.fn(async () => {
      throw new PermanentError('invalid api key');
    });
    await expect(withRetry(fn, { retries: 3, sleep: nosleep })).rejects.toThrow('invalid api key');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
