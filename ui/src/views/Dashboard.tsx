import { api, type Job, type Status } from '../api';
import { StatusPill, Workflow, formatTime } from './shared';

export function Dashboard({
  status, jobs, onOpenJob, onRefresh,
}: {
  status: Status | null;
  jobs: Job[];
  onOpenJob: (id: string) => void;
  onRefresh: () => void;
}) {
  const current = jobs.find((j) => j.id === status?.queue.current) ?? jobs.find((j) => !['COMPLETED', 'FAILED', 'SKIPPED_DUPLICATE'].includes(j.status));
  const recent = jobs.filter((j) => j.status === 'COMPLETED').slice(0, 4);
  const failed = jobs.filter((j) => j.status === 'FAILED').slice(0, 4);

  return (
    <>
      <h1>Dashboard</h1>
      <div className="page-sub">Skript in den Input-Ordner legen – der Rest passiert automatisch.</div>

      {status?.testMode && (
        <div className="banner warn">
          <strong>TEST_MODE aktiv.</strong> Die komplette Pipeline läuft mit Dummy-Antworten, es entstehen keine API-Kosten.
          Für echte Bilder: OPENAI_API_KEY setzen und TEST_MODE in den Einstellungen deaktivieren.
        </div>
      )}
      {status && !status.testMode && !status.apiKeyConfigured && (
        <div className="banner err">Kein OPENAI_API_KEY konfiguriert. Jobs bleiben im Status WAITING.</div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="kpi-label">Verarbeitete Skripte</div>
          <div className="kpi-value">{status?.counts.completed ?? 0}</div>
          <div className="kpi-hint">{status?.counts.total ?? 0} Jobs insgesamt</div>
        </div>
        <div className="card">
          <div className="kpi-label">In Warteschlange</div>
          <div className="kpi-value">{status?.queue.size ?? 0}</div>
          <div className="kpi-hint">{status?.queue.current ? 'Ein Job läuft' : 'Leerlauf'}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Fehler</div>
          <div className="kpi-value" style={{ color: (status?.counts.failed ?? 0) > 0 ? 'var(--err)' : undefined }}>
            {status?.counts.failed ?? 0}
          </div>
          <div className="kpi-hint">Siehe Logs &amp; Failed-Ordner</div>
        </div>
        <div className="card">
          <div className="kpi-label">Kosten heute (Schätzung)</div>
          <div className="kpi-value">${(status?.cost.today ?? 0).toFixed(2)}</div>
          <div className="kpi-hint">Limit ${status?.cost.maxPerDay.toFixed(2)} / Tag · ${status?.cost.maxPerJob.toFixed(2)} / Job</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 18 }}>
        <div className="card">
          <h2>Aktueller Job</h2>
          {current ? (
            <>
              <div className="row spread" style={{ marginBottom: 10 }}>
                <strong>{current.videoTitle ?? current.fileName}</strong>
                <StatusPill status={current.status} />
              </div>
              <Workflow job={current} />
              <div className="kpi-hint" style={{ marginTop: 10 }}>
                {current.fileName} · aktualisiert {formatTime(current.updatedAt)}
              </div>
              {current.error && <div className="banner err" style={{ marginTop: 12 }}>{current.error.message}</div>}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => onOpenJob(current.id)}>Details öffnen</button>
              </div>
            </>
          ) : (
            <div className="muted">Momentan läuft kein Job.</div>
          )}
        </div>

        <div className="card">
          <h2>System</h2>
          <div className="detail-grid">
            <div className="k">Bildprovider</div><div>{status?.imageProvider}</div>
            <div className="k">Bildmodell</div><div className="mono">{status?.models.image}</div>
            <div className="k">Fallback-Bildmodell</div><div className="mono">{status?.models.imageFallback}</div>
            <div className="k">Analysemodell</div><div className="mono">{status?.models.analysis}</div>
            <div className="k">Quality Mode</div><div>{status?.qualityMode}</div>
            <div className="k">Text-Modus</div><div>{status?.textMode}</div>
            <div className="k">Watcher</div>
            <div>{status?.watcher.running ? <span className="pill ok">aktiv</span> : <span className="pill warn">inaktiv</span>}</div>
            <div className="k">Input</div><div className="mono">{status?.folders.input}</div>
            <div className="k">Output</div><div className="mono">{status?.folders.output}</div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={async () => { await api.scan(); onRefresh(); }}>Input-Ordner scannen</button>
            <button className="btn" onClick={() => status && void api.openFolder(status.folders.output)}>Output-Ordner öffnen</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Letzte Ergebnisse</h2>
        {recent.length === 0 && <div className="muted">Noch keine fertigen Thumbnails.</div>}
        <div className="grid cols-4">
          {recent.map((job) => {
            const final = job.outputDir ? `${job.outputDir}/FINAL_THUMBNAIL.jpg` : null;
            return (
              <div key={job.id} onClick={() => onOpenJob(job.id)} style={{ cursor: 'pointer' }}>
                {final && <img className="thumb" src={api.fileUrl(final)} alt={job.videoTitle ?? job.fileName} />}
                <div style={{ fontSize: 12.5, marginTop: 7 }}>{job.thumbnailText ?? job.videoTitle}</div>
                <div className="kpi-hint">Score {job.finalScore ?? '–'} · Variante {job.selectedVariant ?? '–'}</div>
              </div>
            );
          })}
        </div>
      </div>

      {failed.length > 0 && (
        <div className="card">
          <h2>Fehlerhafte Jobs</h2>
          <table>
            <tbody>
              {failed.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => onOpenJob(j.id)}>
                  <td>{j.fileName}</td>
                  <td className="muted">{j.error?.stage}</td>
                  <td style={{ color: 'var(--err)' }}>{j.error?.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
