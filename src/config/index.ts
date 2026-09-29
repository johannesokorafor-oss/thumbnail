import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import type { AppConfig, ChannelProfile, QualityMode, StylePreset, TextMode, TextPosition } from '../types/index.js';

dotenv.config();

export const ROOT = path.resolve(process.cwd());
export const DATA_DIR = path.join(ROOT, 'data');
export const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
export const SETTINGS_FILE = path.join(RUNTIME_DIR, 'settings.json');
export const CHANNEL_PROFILE_FILE = path.join(DATA_DIR, 'channel-profile.json');

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

/**
 * Windows-style example paths from .env are useless on POSIX dev machines,
 * so anything that is not usable here falls back to a workspace folder.
 */
function resolveFolder(value: string | undefined, fallbackRelative: string): string {
  const isWindowsPath = !!value && /^[A-Za-z]:[\\/]/.test(value);
  if (!value || (isWindowsPath && os.platform() !== 'win32')) {
    return path.join(ROOT, fallbackRelative);
  }
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

export const DEFAULT_CHANNEL_PROFILE: ChannelProfile = {
  channel_name: 'Mein Dokumentarkanal',
  default_language: 'de',
  preferred_aspect_ratio: '16:9',
  preferred_resolution: '2560x1440',
  visual_style: 'CINEMATIC_DOCUMENTARY',
  preferred_color_moods: ['deep teal & amber', 'candle gold on near-black', 'cold blue vs warm ember'],
  preferred_text_style: 'kurz, deutsch, großbuchstaben, hoher kontrast, maximal 5 Wörter',
  preferred_font: 'Inter ExtraBold, Arial Black, sans-serif',
  preferred_text_position: 'AUTO',
  preferred_thumbnail_density: 'low',
  preferred_subject_size: 'large',
  brand_rules: [
    'Ein einziger klarer Hauptfokus pro Thumbnail',
    'Kinematografisches Licht, keine flache Ausleuchtung',
    'Hoher Kontrast zwischen Motiv und Hintergrund',
    'Immer eine bewusste textfreie Fläche vorsehen',
  ],
  forbidden_elements: [
    'Stockfoto-Ästhetik',
    'plastische, überglänzende AI-Gesichter',
    'zufällige Partikel und unmotivierter Nebel',
    'überall Gold',
    'billige Sci-Fi-Optik',
    'chaotische Hintergründe mit vielen Kleinobjekten',
    'irreführende Tatsachenbehauptungen',
  ],
  text_mode: 'LOCAL_OVERLAY',
  max_text_words: 5,
};

function envConfig(): AppConfig {
  return {
    analysisModel: process.env.ANALYSIS_MODEL || 'gpt-6-astra',
    analysisModelFallback: process.env.ANALYSIS_MODEL_FALLBACK || 'gpt-5-mini',
    imageModel: process.env.IMAGE_MODEL || 'gpt-image-2.5-sunburst',
    fallbackImageModel: process.env.IMAGE_MODEL_FALLBACK || 'gpt-image-2.5-flare',
    imageProvider: (process.env.IMAGE_PROVIDER as 'openai' | 'google') || 'openai',
    quality: process.env.IMAGE_QUALITY || 'max',
    resolution: process.env.IMAGE_SIZE || '2560x1440',
    qualityMode: (process.env.QUALITY_MODE as QualityMode) || 'BALANCED',
    variantCount: num(process.env.VARIANT_COUNT, 4),
    maxVariantCount: num(process.env.MAX_VARIANT_COUNT, 6),
    maxCostPerJob: num(process.env.MAX_COST_PER_JOB, 2.5),
    maxDailyCost: num(process.env.MAX_COST_PER_DAY, 25),
    inputFolder: resolveFolder(process.env.INPUT_FOLDER, 'data/workspace/Scripts/Incoming'),
    outputFolder: resolveFolder(process.env.OUTPUT_FOLDER, 'data/workspace/Thumbnails/Generated'),
    archiveFolder: resolveFolder(process.env.ARCHIVE_FOLDER, 'data/workspace/Thumbnails/Archive'),
    failedFolder: resolveFolder(process.env.FAILED_FOLDER, 'data/workspace/Thumbnails/Failed'),
    referenceFolder: resolveFolder(process.env.REFERENCE_FOLDER, 'data/workspace/ThumbnailReferences'),
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'de',
    textMode: (process.env.TEXT_MODE as TextMode) || 'LOCAL_OVERLAY',
    font: process.env.FONT || DEFAULT_CHANNEL_PROFILE.preferred_font,
    textPosition: (process.env.TEXT_POSITION as TextPosition) || 'AUTO',
    stylePreset: (process.env.STYLE_PRESET as StylePreset) || 'AUTO',
    testMode: bool(process.env.TEST_MODE, !process.env.OPENAI_API_KEY),
    port: num(process.env.PORT, 3000),
    logLevel: process.env.LOG_LEVEL || 'info',
    watcherEnabled: bool(process.env.WATCHER_ENABLED, true),
  };
}

let cached: AppConfig | null = null;

/** Effective config = .env defaults overridden by UI settings (data/runtime/settings.json). */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const base = envConfig();
  let overrides: Partial<AppConfig> = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      overrides = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<AppConfig>;
    } catch {
      overrides = {};
    }
  }
  cached = { ...base, ...overrides };
  return cached;
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  const next = { ...current, ...patch };
  ensureDir(RUNTIME_DIR);
  let stored: Partial<AppConfig> = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
      stored = {};
    }
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...stored, ...patch }, null, 2));
  cached = next;
  return next;
}

export function resetConfigCache(): void {
  cached = null;
}

export function getChannelProfile(): ChannelProfile {
  if (!fs.existsSync(CHANNEL_PROFILE_FILE)) {
    ensureDir(DATA_DIR);
    fs.writeFileSync(CHANNEL_PROFILE_FILE, JSON.stringify(DEFAULT_CHANNEL_PROFILE, null, 2));
    return DEFAULT_CHANNEL_PROFILE;
  }
  try {
    return { ...DEFAULT_CHANNEL_PROFILE, ...JSON.parse(fs.readFileSync(CHANNEL_PROFILE_FILE, 'utf8')) };
  } catch {
    return DEFAULT_CHANNEL_PROFILE;
  }
}

export function saveChannelProfile(profile: ChannelProfile): ChannelProfile {
  ensureDir(DATA_DIR);
  fs.writeFileSync(CHANNEL_PROFILE_FILE, JSON.stringify(profile, null, 2));
  return profile;
}

/** Quality-mode presets (section 16). */
export function qualityModeSettings(mode: QualityMode) {
  switch (mode) {
    case 'FAST':
      return { concepts: 3, variants: 2, quality: 'high', critique: 'light' as const, allowSecondPass: false };
    case 'MAX':
      return { concepts: 5, variants: 5, quality: 'max', critique: 'full' as const, allowSecondPass: true };
    default:
      return { concepts: 5, variants: 4, quality: 'max', critique: 'full' as const, allowSecondPass: false };
  }
}

export function ensureWorkspaceFolders(cfg: AppConfig = getConfig()): void {
  for (const dir of [cfg.inputFolder, cfg.outputFolder, cfg.archiveFolder, cfg.failedFolder, cfg.referenceFolder, RUNTIME_DIR]) {
    try {
      ensureDir(dir);
    } catch {
      /* permission issues are surfaced later by the pipeline */
    }
  }
}

export const IMAGE_QUALITY_FALLBACK_CHAIN = ['max', 'xhigh', 'high', 'medium'];
