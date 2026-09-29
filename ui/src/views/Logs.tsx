import { type LogRecord } from '../api';

export function Logs({ logs }: { logs: LogRecord[] }) {
  return (
    <>
      <h1>Logs</h1>
      <div className="page-sub">Strukturiertes Logging – API-Keys und Secrets werden automatisch redigiert.</div>
      <div className="card scroll mono">
        {[...logs].reverse().map((l, i) => (
          <div className="logline" key={`${l.timestamp}-${i}`}>
            <span className="muted">{new Date(l.timestamp).toLocaleTimeString('de-DE')}</span>
            <span className={`lvl ${l.level}`}>{l.level.toUpperCase()}</span>
            <span>
              {l.message}
              {l.stage ? <span className="muted"> · {l.stage}</span> : null}
              {l.error ? <span style={{ color: 'var(--err)' }}> · {l.error}</span> : null}
            </span>
          </div>
        ))}
        {logs.length === 0 && <div className="muted">Noch keine Logeinträge.</div>}
      </div>
    </>
  );
}
