/** Filename/slug sanitizing (section 45) — Windows-safe, deterministic, readable. */
const UMLAUTS: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
  á: 'a', à: 'a', â: 'a', é: 'e', è: 'e', ê: 'e', í: 'i', ì: 'i',
  ó: 'o', ò: 'o', ô: 'o', ú: 'u', ù: 'u', û: 'u', ç: 'c', ñ: 'n',
};

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

export function sanitizeName(input: string, maxLength = 80): string {
  const transliterated = (input || '')
    .split('')
    .map((c) => UMLAUTS[c] ?? c)
    .join('');

  let out = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
    .replace(/_+$/g, '');

  if (!out) out = 'Unbenannt';
  if (WINDOWS_RESERVED.has(out.toUpperCase())) out = `_${out}`;
  return out;
}

export function uniqueDirName(base: string, exists: (name: string) => boolean): string {
  if (!exists(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${String(i).padStart(2, '0')}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}
