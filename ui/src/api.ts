export interface Status {
  testMode: boolean;
  apiReachable: boolean;
  apiKeyConfigured: boolean;
  imageProvider: string;
  models: { analysis: string; analysisFallback: string; image: string; imageFallback: string };
  qualityMode: string;
  textMode: string;
  folders: { input: string; output: string; archive: string; failed: string; reference: string };
  watcher: { running: boolean; folder: string };
  queue: { current: string | null; pending: string[]; size: number };
  counts: { total: number; completed: number; failed: number };
  cost: { today: number; session: number; maxPerJob: number; maxPerDay: number; isEstimate: boolean };
}

export interface Job {
  id: string;
  fileName: string;
  sourceFile: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  outputDir?: string;
  videoTitle?: string;
  thumbnailText?: string;
  conceptSummary?: string;
  selectionReason?: string;
  selectedVariant?: number;
  finalScore?: number;
  estimatedCostUsd: number;
  generationCount: number;
  iterationCount: number;
  steps: { stage: string; label: string; at: string }[];
  variants?: {
    index: number; file: string; model: string; quality: string; size: string; conceptId: string;
    critique?: { summary: string; scoreTotal: number; improvementPrompt: string };
  }[];
  concepts?: { id: string; label: string; idea: string; textArea: string; thumbnailText: string; scoreTotal?: number; unusual: boolean }[];
  analysis?: Record<string, unknown>;
  qa?: { passed: boolean; checks: { name: string; passed: boolean; detail: string }[] };
  error?: { message: string; stage: string; permanent: boolean };
}

export interface LogRecord {
  timestamp: string; level: string; message: string;
  job_id?: string; stage?: string; error?: string;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => req<Status>('/api/status'),
  jobs: () => req<Job[]>('/api/jobs'),
  job: (id: string) => req<Job>(`/api/jobs/${id}`),
  logs: () => req<LogRecord[]>('/api/logs?limit=200'),
  settings: () => req<{ config: Record<string, unknown>; channelProfile: Record<string, unknown> }>('/api/settings'),
  saveSettings: (config: Record<string, unknown>, channelProfile?: Record<string, unknown>) =>
    req('/api/settings', { method: 'PUT', body: JSON.stringify({ config, channelProfile }) }),
  scan: () => req<{ queued: number }>('/api/scan', { method: 'POST' }),
  process: (file: string, force = false) => req('/api/process', { method: 'POST', body: JSON.stringify({ file, force }) }),
  inputFiles: () => req<{ path: string; name: string; size: number; modified: string }[]>('/api/input-files'),
  regenerate: (id: string, body: Record<string, unknown> = {}) =>
    req(`/api/jobs/${id}/regenerate`, { method: 'POST', body: JSON.stringify(body) }),
  changeText: (id: string, text: string) => req(`/api/jobs/${id}/text`, { method: 'POST', body: JSON.stringify({ text }) }),
  openFolder: (path: string) => req('/api/open-folder', { method: 'POST', body: JSON.stringify({ path }) }),
  deleteJob: (id: string) => req(`/api/jobs/${id}`, { method: 'DELETE' }),
  costs: () => req<{ entries: { timestamp: string; kind: string; model: string; quality?: string; count: number; estimatedUsd: number }[]; today: number; session: number; limits: { perJob: number; perDay: number } }>('/api/costs'),
  fileUrl: (p: string) => `/api/file?path=${encodeURIComponent(p)}`,
};
