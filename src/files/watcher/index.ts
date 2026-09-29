import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar, { type FSWatcher } from 'chokidar';
import { logger } from '../../utils/logger.js';
import { parserRegistry } from '../parser/index.js';

export interface WatcherOptions {
  /** Poll interval for the stability check. */
  stabilityIntervalMs?: number;
  /** Number of consecutive identical size samples required. */
  stabilityChecks?: number;
  usePolling?: boolean;
}

const TEMP_PATTERNS = [
  /^~\$/, // Office lock files
  /^\./, // dotfiles
  /\.tmp$/i,
  /\.temp$/i,
  /\.crdownload$/i,
  /\.part$/i,
  /\.partial$/i,
  /\.download$/i,
  /\.swp$/i,
  /^thumbs\.db$/i,
  /^desktop\.ini$/i,
];

export function isTemporaryFile(fileName: string): boolean {
  return TEMP_PATTERNS.some((re) => re.test(fileName));
}

/** Output artefacts must never be re-ingested as input (section 3). */
export function isOutputArtifact(fileName: string): boolean {
  return /^(FINAL_THUMBNAIL|CLEAN_ART|VARIANT_\d+|THUMBNAIL_ANALYSIS|PROMPT_USED|MOBILE_PREVIEW)/i.test(fileName);
}

export function isEligible(filePath: string): boolean {
  const name = path.basename(filePath);
  if (isTemporaryFile(name)) return false;
  if (isOutputArtifact(name)) return false;
  return parserRegistry.supports(filePath);
}

/**
 * Robust folder watcher:
 *  - ignores temp/output files
 *  - waits until the file size is stable before emitting
 *  - never emits the same path twice while it is in flight
 */
export class ScriptWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private inFlight = new Set<string>();
  private opts: Required<WatcherOptions>;
  private folder = '';

  constructor(opts: WatcherOptions = {}) {
    super();
    this.opts = {
      stabilityIntervalMs: opts.stabilityIntervalMs ?? 500,
      stabilityChecks: opts.stabilityChecks ?? 3,
      usePolling: opts.usePolling ?? process.platform === 'win32',
    };
  }

  get watchedFolder(): string {
    return this.folder;
  }

  get isRunning(): boolean {
    return this.watcher !== null;
  }

  async start(folder: string): Promise<void> {
    await this.stop();
    this.folder = folder;
    fs.mkdirSync(folder, { recursive: true });
    this.watcher = chokidar.watch(folder, {
      depth: 0,
      ignoreInitial: false,
      usePolling: this.opts.usePolling,
      awaitWriteFinish: false,
    });
    this.watcher.on('add', (p: string) => void this.handle(p));
    this.watcher.on('change', (p: string) => void this.handle(p));
    this.watcher.on('error', (err: unknown) => logger.error('Watcher-Fehler', { stage: 'watcher', error: String(err) }));
    logger.info(`Überwache Input-Ordner: ${folder}`, { stage: 'watcher' });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.info('Watcher gestoppt', { stage: 'watcher' });
    }
  }

  private async handle(filePath: string): Promise<void> {
    if (!isEligible(filePath)) return;
    if (this.inFlight.has(filePath)) return; // no parallel/duplicate processing
    this.inFlight.add(filePath);
    try {
      const stable = await this.waitForStableSize(filePath);
      if (!stable) return;
      this.emit('script', filePath);
    } catch (err) {
      logger.warn(`Datei konnte nicht übernommen werden: ${filePath}`, { stage: 'watcher', error: String(err) });
    } finally {
      // release after a grace period so an editor's multi-write burst collapses into one job
      setTimeout(() => this.inFlight.delete(filePath), 2000);
    }
  }

  /** Size must stay identical for N consecutive samples before we touch the file. */
  async waitForStableSize(filePath: string): Promise<boolean> {
    let lastSize = -1;
    let stable = 0;
    for (let i = 0; i < 40; i++) {
      let size: number;
      try {
        size = (await fsp.stat(filePath)).size;
      } catch {
        return false; // file vanished again
      }
      if (size > 0 && size === lastSize) {
        stable++;
        if (stable >= this.opts.stabilityChecks - 1) return true;
      } else {
        stable = 0;
      }
      lastSize = size;
      await new Promise((r) => setTimeout(r, this.opts.stabilityIntervalMs));
    }
    return false;
  }

  /** One-shot scan, used on startup and by the "Ordner neu scannen" button. */
  async scanOnce(folder = this.folder): Promise<string[]> {
    if (!folder || !fs.existsSync(folder)) return [];
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.join(folder, e.name))
      .filter(isEligible);
  }
}
