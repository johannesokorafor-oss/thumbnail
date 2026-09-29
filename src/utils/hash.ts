import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256OfFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256OfString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function shortId(prefix = 'job'): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}
