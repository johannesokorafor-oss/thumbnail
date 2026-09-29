import { describe, expect, it } from 'vitest';
import { redact } from '../src/utils/logger.js';

describe('Logging-Redaktion', () => {
  it('entfernt Keys aus Objekten', () => {
    const out = redact({ apiKey: 'sk-verysecretvalue123', nested: { authorization: 'Bearer x' }, ok: 'wert' });
    expect(JSON.stringify(out)).not.toContain('verysecret');
    expect(out.ok).toBe('wert');
  });

  it('entfernt Key-Muster aus Strings', () => {
    expect(redact('Fehler mit sk-abcdef1234567890 aufgetreten')).toContain('[REDACTED]');
  });
});
