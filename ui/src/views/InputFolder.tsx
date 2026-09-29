import { useCallback, useEffect, useState } from 'react';
import { api, type Status } from '../api';

export function InputFolder({ status, onRefresh }: { status: Status | null; onRefresh: () => void }) {
  const [files, setFiles] = useState<{ path: string; name: string; size: number; modified: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    api.inputFiles().then(setFiles).catch((e) => setMessage(String(e.message)));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const process = async (file: string, force: boolean) => {
    setBusy(true);
    try {
      const res = (await api.process(file, force)) as { jobId?: string; skipped?: string };
      setMessage(res.skipped ? 'Datei wurde bereits verarbeitet (identischer SHA-256-Hash). "Erneut erzwingen" nutzen.' : 'Job eingereiht.');
      onRefresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Input-Ordner</h1>
      <div className="page-sub mono">{status?.folders.input}</div>
      {message && <div className="banner">{message}</div>}
      <div className="card">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Erkannte Skripte ({files.length})</h2>
          <div className="row">
            <button className="btn" onClick={load}>Aktualisieren</button>
            <button className="btn primary" disabled={busy} onClick={async () => { await api.scan(); load(); onRefresh(); }}>
              Alle neuen verarbeiten
            </button>
            <button className="btn" onClick={() => status && void api.openFolder(status.folders.input)}>Ordner öffnen</button>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>Datei</th><th>Größe</th><th>Geändert</th><th></th></tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.path}>
                <td>{f.name}</td>
                <td className="muted">{(f.size / 1024).toFixed(1)} KB</td>
                <td className="muted">{new Date(f.modified).toLocaleString('de-DE')}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn" disabled={busy} onClick={() => process(f.path, false)}>Verarbeiten</button>{' '}
                  <button className="btn" disabled={busy} onClick={() => process(f.path, true)}>Erneut erzwingen</button>
                </td>
              </tr>
            ))}
            {files.length === 0 && <tr><td colSpan={4} className="muted">Keine unterstützten Skripte gefunden (.txt, .md).</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
