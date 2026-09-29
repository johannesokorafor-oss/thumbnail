import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkScript, parserRegistry } from '../src/files/parser/index.js';
import { isEligible, isOutputArtifact, isTemporaryFile } from '../src/files/watcher/index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-parser-'));
const long = 'Dies ist ein vollständiger Testsatz über ein spannendes Thema. '.repeat(20);

describe('Parser', () => {
  it('liest .txt', async () => {
    const f = path.join(tmp, 'a.txt');
    fs.writeFileSync(f, `Mein Titel\n\n${long}`);
    const parsed = await parserRegistry.parse(f);
    expect(parsed.titleGuess).toBe('Mein Titel');
    expect(parsed.wordCount).toBeGreaterThan(50);
  });

  it('entfernt Markdown-Rauschen', async () => {
    const f = path.join(tmp, 'b.md');
    fs.writeFileSync(f, `# Titel\n\n\`\`\`code\`\`\`\n[Link](http://x)\n\n${long}`);
    const parsed = await parserRegistry.parse(f);
    expect(parsed.text).not.toContain('http://x');
    expect(parsed.titleGuess).toBe('Titel');
  });

  it('lehnt nicht unterstützte Formate ab', async () => {
    const f = path.join(tmp, 'c.pdf');
    fs.writeFileSync(f, long);
    await expect(parserRegistry.parse(f)).rejects.toThrow(/Nicht unterstütztes/);
  });

  it('lehnt zu kurze Skripte ab', async () => {
    const f = path.join(tmp, 'd.txt');
    fs.writeFileSync(f, 'zu kurz');
    await expect(parserRegistry.parse(f)).rejects.toThrow(/zu kurz/);
  });

  it('chunkt lange Skripte mit Überlappung', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Absatz ${i} ${'wort '.repeat(80)}`).join('\n\n');
    const chunks = chunkScript(text, 20_000, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').length).toBeGreaterThan(text.length * 0.9);
  });
});

describe('Watcher-Filter', () => {
  it('ignoriert temporäre Dateien', () => {
    expect(isTemporaryFile('~$script.txt')).toBe(true);
    expect(isTemporaryFile('script.txt.crdownload')).toBe(true);
    expect(isTemporaryFile('script.txt')).toBe(false);
  });

  it('ignoriert Ausgabedateien', () => {
    expect(isOutputArtifact('FINAL_THUMBNAIL.jpg')).toBe(true);
    expect(isOutputArtifact('VARIANT_01.png')).toBe(true);
  });

  it('akzeptiert nur unterstützte Skripte', () => {
    expect(isEligible('/x/skript.txt')).toBe(true);
    expect(isEligible('/x/skript.md')).toBe(true);
    expect(isEligible('/x/skript.docx')).toBe(false);
    expect(isEligible('/x/.hidden.txt')).toBe(false);
  });
});
