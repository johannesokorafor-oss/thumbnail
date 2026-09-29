import fs from 'node:fs/promises';
import path from 'node:path';
import { PermanentError } from '../../utils/retry.js';

export interface ParsedScript {
  text: string;
  wordCount: number;
  charCount: number;
  titleGuess: string;
  sourceFile: string;
  format: string;
}

export interface ScriptParser {
  extensions: string[];
  parse(filePath: string): Promise<string>;
}

const txtParser: ScriptParser = {
  extensions: ['.txt'],
  async parse(filePath) {
    return fs.readFile(filePath, 'utf8');
  },
};

const mdParser: ScriptParser = {
  extensions: ['.md', '.markdown'],
  async parse(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    // Keep the semantic text but drop markdown noise so the analyzer sees prose.
    return raw
      .replace(/^---[\s\S]*?---\n/, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/[*_`>]/g, '');
  },
};

/** Registry — add .docx/.pdf parsers here without touching the pipeline. */
export class ParserRegistry {
  private parsers: ScriptParser[] = [];

  register(parser: ScriptParser): void {
    this.parsers.push(parser);
  }

  supportedExtensions(): string[] {
    return this.parsers.flatMap((p) => p.extensions);
  }

  supports(filePath: string): boolean {
    return this.supportedExtensions().includes(path.extname(filePath).toLowerCase());
  }

  find(filePath: string): ScriptParser | undefined {
    const ext = path.extname(filePath).toLowerCase();
    return this.parsers.find((p) => p.extensions.includes(ext));
  }

  async parse(filePath: string): Promise<ParsedScript> {
    const parser = this.find(filePath);
    if (!parser) {
      throw new PermanentError(`Nicht unterstütztes Dateiformat: ${path.extname(filePath) || '(keine Endung)'}`, 'UNSUPPORTED_FILE');
    }
    const raw = await parser.parse(filePath);
    const text = raw.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
    if (text.length < 80) {
      throw new PermanentError('Skript ist zu kurz oder leer (mindestens 80 Zeichen erwartet).', 'INVALID_INPUT');
    }
    const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    const base = path.basename(filePath, path.extname(filePath));
    const titleGuess = firstLine.length > 3 && firstLine.length <= 120 ? firstLine.replace(/^#+\s*/, '') : base;
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      titleGuess,
      sourceFile: filePath,
      format: path.extname(filePath).toLowerCase(),
    };
  }
}

export const parserRegistry = new ParserRegistry();
parserRegistry.register(txtParser);
parserRegistry.register(mdParser);

/**
 * Long-context strategy: if a script exceeds the safe window, split it into
 * overlapping chunks at paragraph boundaries so nothing is silently dropped.
 */
export function chunkScript(text: string, maxChars = 45_000, overlap = 1_200): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxChars && current) {
      chunks.push(current);
      current = current.slice(-overlap) + '\n\n' + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}
