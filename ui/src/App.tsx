import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Job, type LogRecord, type Status } from './api';
import { Dashboard } from './views/Dashboard';
import { InputFolder } from './views/InputFolder';
import { Queue } from './views/Queue';
import { Results } from './views/Results';
import { Settings } from './views/Settings';
import { Logs } from './views/Logs';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'input', label: 'Input-Ordner', icon: '↥' },
  { id: 'queue', label: 'Warteschlange', icon: '≡' },
  { id: 'results', label: 'Thumbnails', icon: '▣' },
  { id: 'settings', label: 'Einstellungen', icon: '⚙' },
  { id: 'logs', label: 'Logs', icon: '☰' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, j] = await Promise.all([api.status().catch(() => null), api.jobs().catch(() => [])]);
    if (s) setStatus(s);
    setJobs(j);
  }, []);

  useEffect(() => {
    void refresh();
    void api.logs().then(setLogs).catch(() => undefined);
    const es = new EventSource('/api/events');
    es.addEventListener('job', (e) => {
      const job = JSON.parse((e as MessageEvent).data) as Job;
      setJobs((prev) => {
        const next = prev.filter((p) => p.id !== job.id);
        return [job, ...next].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    });
    es.addEventListener('jobs', (e) => setJobs(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('log', (e) => setLogs((prev) => [...prev.slice(-300), JSON.parse((e as MessageEvent).data)]));
    es.addEventListener('queue', () => void refresh());
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [refresh]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === (selectedJob ?? status?.queue.current)) ?? jobs[0],
    [jobs, selectedJob, status],
  );

  const openJob = (id: string) => {
    setSelectedJob(id);
    setTab('results');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Thumbnail <span>Studio</span></div>
        <div className="brand-sub">Automatische YouTube-Thumbnails</div>
        <nav className="nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
        <div style={{ position: 'absolute', bottom: 18, left: 14, right: 14 }}>
          {status && (
            <div className="card tight">
              <div className="row spread">
                <span className="pill info">{status.testMode ? 'TEST MODE' : status.imageProvider.toUpperCase()}</span>
                <span className={`pill ${status.apiReachable ? 'ok' : 'warn'}`}>{status.apiReachable ? 'API OK' : 'API OFF'}</span>
              </div>
              <div className="kpi-hint" style={{ marginTop: 8 }}>
                Heute ca. ${status.cost.today.toFixed(2)} (Schätzung)
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {tab === 'dashboard' && <Dashboard status={status} jobs={jobs} onOpenJob={openJob} onRefresh={refresh} />}
        {tab === 'input' && <InputFolder status={status} onRefresh={refresh} />}
        {tab === 'queue' && <Queue jobs={jobs} status={status} onOpenJob={openJob} />}
        {tab === 'results' && (
          <Results jobs={jobs} active={activeJob} onSelect={setSelectedJob} onRefresh={refresh} />
        )}
        {tab === 'settings' && <Settings onSaved={refresh} />}
        {tab === 'logs' && <Logs logs={logs} />}
      </main>
    </div>
  );
}
