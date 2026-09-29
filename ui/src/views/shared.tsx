import type { Job } from '../api';

export const PIPELINE_STEPS = [
  { key: 'DETECTED', label: 'Skript erkannt' },
  { key: 'ANALYZING', label: 'Analyse' },
  { key: 'DESIGNING', label: 'Konzepte' },
  { key: 'GENERATING', label: 'Varianten' },
  { key: 'EVALUATING', label: 'Bewertung' },
  { key: 'FINALIZING', label: 'Finalisierung' },
  { key: 'COMPLETED', label: 'Fertig' },
];

export function Workflow({ job }: { job?: Job }) {
  if (!job) return <div className="muted">Kein aktiver Job.</div>;
  const reached = new Set(job.steps.map((s) => s.stage));
  const order = PIPELINE_STEPS.map((s) => s.key);
  const currentIdx = order.indexOf(job.status);
  return (
    <div className="workflow">
      {PIPELINE_STEPS.map((s, i) => {
        let cls = 'step';
        if (job.status === 'FAILED' && i === Math.max(currentIdx, 0)) cls += ' failed';
        else if (job.status === s.key) cls += ' active';
        else if (reached.has(s.key) || (currentIdx > i && currentIdx >= 0)) cls += ' done';
        return (
          <div key={s.key} className={cls}>
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMPLETED: 'ok', FAILED: 'err', WAITING: 'warn', SKIPPED_DUPLICATE: 'warn', QUEUED: 'info',
  };
  return <span className={`pill ${map[status] ?? 'info'}`}>{status}</span>;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
}
