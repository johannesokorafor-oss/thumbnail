import { type Job, type Status } from '../api';
import { StatusPill, Workflow, formatTime } from './shared';

export function Queue({ jobs, status, onOpenJob }: { jobs: Job[]; status: Status | null; onOpenJob: (id: string) => void }) {
  const active = jobs.filter((j) => !['COMPLETED', 'FAILED', 'SKIPPED_DUPLICATE'].includes(j.status));
  return (
    <>
      <h1>Verarbeitungs-Warteschlange</h1>
      <div className="page-sub">
        Jobs werden seriell abgearbeitet – das hält API-Limits und Kosten kontrollierbar.
      </div>

      {active.map((job) => (
        <div className="card" key={job.id} style={{ marginBottom: 14 }}>
          <div className="row spread">
            <strong>{job.videoTitle ?? job.fileName}</strong>
            <div className="row">
              {status?.queue.current === job.id && <span className="pill info">läuft</span>}
              <StatusPill status={job.status} />
            </div>
          </div>
          <Workflow job={job} />
          <div className="kpi-hint">{job.fileName} · {formatTime(job.updatedAt)}</div>
          {job.error && <div className="banner err" style={{ marginTop: 10 }}>{job.error.message}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => onOpenJob(job.id)}>Details</button>
          </div>
        </div>
      ))}
      {active.length === 0 && <div className="card muted">Keine aktiven Jobs.</div>}

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Alle Jobs</h2>
        <table>
          <thead><tr><th>Datei</th><th>Titel</th><th>Status</th><th>Score</th><th>Kosten*</th><th>Aktualisiert</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => onOpenJob(j.id)}>
                <td>{j.fileName}</td>
                <td className="muted">{j.videoTitle ?? '–'}</td>
                <td><StatusPill status={j.status} /></td>
                <td>{j.finalScore ?? '–'}</td>
                <td className="muted">${(j.estimatedCostUsd ?? 0).toFixed(3)}</td>
                <td className="muted">{formatTime(j.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kpi-hint" style={{ marginTop: 8 }}>* geschätzte Kosten, keine Abrechnung</div>
      </div>
    </>
  );
}
