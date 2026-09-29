import { describe, expect, it } from 'vitest';
import { sanitizeName, uniqueDirName } from '../src/utils/sanitize.js';

describe('sanitizeName', () => {
  it('erzeugt Windows-sichere, lesbare Namen', () => {
    expect(sanitizeName('Alchemie – Das verbotene Wissen!!!????')).toBe('Alchemie_Das_verbotene_Wissen');
  });

  it('transliteriert Umlaute', () => {
    expect(sanitizeName('Über die Größe der Welt')).toBe('Ueber_die_Groesse_der_Welt');
  });

  it('entfernt verbotene Windows-Zeichen', () => {
    expect(sanitizeName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('schützt reservierte Windows-Namen', () => {
    expect(sanitizeName('CON')).toBe('_CON');
  });

  it('fällt auf einen Standardnamen zurück', () => {
    expect(sanitizeName('!!!')).toBe('Unbenannt');
  });

  it('vergibt eindeutige Ordnernamen', () => {
    const taken = new Set(['Thema', 'Thema_02']);
    expect(uniqueDirName('Thema', (n) => taken.has(n))).toBe('Thema_03');
  });
});
