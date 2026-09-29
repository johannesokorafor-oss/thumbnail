import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { RUNTIME_DIR } from '../config/index.js';

export interface LogRecord {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  job_id?: string;
  file?: string;
  stage?: string;
  model?: string;
  duration_ms?: number;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

const SECRET_KEYS = /(api[_-]?key|authorization|secret|token|password|credential)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_\-]{8,}|AIza[A-Za-z0-9_\-]{10,})\b/g;

/** Never let secrets reach the log sink (section 38). */
export function redact<T>(value: T): T {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]') as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v);
    }
    return out as unknown as T;
  }
  return value;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export class Logger extends EventEmitter {
  private buffer: LogRecord[] = [];
  private readonly maxBuffer = 500;
  private logFile: string;
  level: keyof typeof LEVELS = 'info';

  constructor() {
    super();
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    this.logFile = path.join(RUNTIME_DIR, 'app.log');
  }

  private write(level: LogRecord['level'], message: string, meta: Partial<LogRecord> = {}) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const record: LogRecord = redact({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    }) as LogRecord;
    this.buffer.push(record);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    this.emit('log', record);
    const line = JSON.stringify(record);
    try {
      fs.appendFileSync(this.logFile, line + '\n');
    } catch {
      /* ignore log write failures */
    }
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`[${record.level.toUpperCase()}] ${record.message}${record.stage ? ` (${record.stage})` : ''}`);
    }
  }

  debug(m: string, meta?: Partial<LogRecord>) { this.write('debug', m, meta); }
  info(m: string, meta?: Partial<LogRecord>) { this.write('info', m, meta); }
  warn(m: string, meta?: Partial<LogRecord>) { this.write('warn', m, meta); }
  error(m: string, meta?: Partial<LogRecord>) { this.write('error', m, meta); }

  recent(limit = 200): LogRecord[] {
    return this.buffer.slice(-limit);
  }
}

export const logger = new Logger();
