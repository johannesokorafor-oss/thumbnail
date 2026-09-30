import { useState } from 'react';
import { api, type Job } from '../api';
import { StatusPill, Workflow, formatTime } from './shared';

export function Results({
  jobs, active, onSelect, onRefresh,
}: {
  jobs: Job[];
  active?: Job;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const done = jobs.filter((j) => j.outputDir);

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try {
      await fn();
      setMsg(`${label} gestartet.`);
      onRefresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finalUrl = active?.outputDir ? api.fileUrl(`${active.outputDir}/FINAL_THUMBNAIL.jpg`) : null;

  return (
    <>
      <h1>Generierte Thumbnails</h1>
      <div className="page-sub">Finale Datei, Varianten, Bewertung und manuelle Nachsteuerung.</div>
      {msg && <div className="banner">{msg}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row">
          {done.map((j) => (
            <button key={j.id} className={`btn ${active?.id === j.id ? 'primary' : ''}`} onClick={() => onSelect(j.id)}>
              {j.videoTitle ?? j.fileName}
            </button>
          ))}
          {done.length === 0 && <span className="muted">Noch keine Ergebnisse vorhanden.</span>}
        </div>
      </div>

      {active && (
        <>
          <div className="grid cols-2" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="row spread" style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>Finales Thumbnail</h2>
                <StatusPill status={active.status} />
              </div>
              {finalUrl ? <img className="thumb" src={`${finalUrl}&v=${active.updatedAt}`} alt="Finales Thumbnail" /> : <div className="muted">Noch kein finales Bild.</div>}
              <Workflow job={active} />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" disabled={busy} onClick={() => act(() => api.regenerate(active.id), 'Komplette Neugenerierung')}>REGENERATE</button>
                <button className="btn" disabled={busy} onClick={() => act(() => api.regenerate(active.id, { resumeFrom: 'generation' }), 'Varianten-Neugenerierung')}>REGENERATE VARIANTS</button>
                <button className="btn" disabled={busy} onClick={() => act(() => api.regenerate(active.id, { resumeFrom: 'concepts' }), 'Konzept-Überarbeitung')}>EDIT CONCEPT</button>
                <button className="btn" disabled={!active.outputDir} onClick={() => active.outputDir && void api.openFolder(active.outputDir)}>OPEN OUTPUT FOLDER</button>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <input
                  className="mono"
                  style={{ flex: 1, background: '#0d1119', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 8, padding: '8px 11px' }}
                  placeholder={active.thumbnailText ?? 'Neuer Thumbnail-Text'}
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                />
                <button className="btn" disabled={busy || !newText.trim()} onClick={() => act(() => api.changeText(active.id, newText), 'Textänderung')}>CHANGE TEXT</button>
              </div>
            </div>

            <div className="card">
              <h2>Ergebnisdaten</h2>
              <div className="detail-grid">
                <div className="k">Videotitel</div><div>{active.videoTitle ?? '–'}</div>
                <div className="k">Thumbnail-Text</div><div><strong>{active.thumbnailText ?? '–'}</strong></div>
                <div className="k">Konzept</div><div>{active.conceptSummary ?? '–'}</div>
                <div className="k">Gewählte Variante</div><div>#{active.selectedVariant ?? '–'}</div>
                <div className="k">Auswahlgrund</div><div>{active.selectionReason ?? '–'}</div>
                <div className="k">Design-Score</div><div>{active.finalScore ?? '–'} / 10</div>
                <div className="k">Kandidaten</div><div>{active.variants?.length ?? 0} generiert · {active.rejectedCount ?? 0} verworfen</div>
                <div className="k">Generierungen</div><div>{active.generationCount} · Iterationen {active.iterationCount}</div>
                <div className="k">Kosten (Schätzung)</div><div>${(active.estimatedCostUsd ?? 0).toFixed(3)}</div>
                <div className="k">Ausgabeordner</div><div className="mono">{active.outputDir ?? '–'}</div>
                <div className="k">Zuletzt</div><div>{formatTime(active.updatedAt)}</div>
              </div>

              {active.outputDir && (
                <>
                  <h3 style={{ marginTop: 16 }}>Mobile-Vorschau (320px)</h3>
                  <img className="thumb mobile-sim" src={`${api.fileUrl(`${active.outputDir}/MOBILE_PREVIEW.jpg`)}&v=${active.updatedAt}`} alt="Mobile Vorschau" />
                </>
              )}
            </div>
          </div>

          {active.status === 'REJECTED' && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="row spread">
                <h2 style={{ margin: 0 }}>Kein Kandidat war gut genug</h2>
                <span className="pill warn">bewusst kein Export</span>
              </div>
              <p className="kpi-hint">
                Es wurde absichtlich kein finales Thumbnail erzeugt: Ein schwaches Bild soll nicht
                dadurch zum „besten" werden, dass die übrigen noch schwächer sind. Alle Kandidaten
                bleiben unten zur Ansicht erhalten, der vollständige Bericht liegt als
                REJECTION_REPORT.json im Ausgabeordner.
              </p>
              {active.error?.message && <p>{active.error.message}</p>}
            </div>
          )}

          {active.generation && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="row spread">
                <h2 style={{ margin: 0 }}>Tatsächlich verwendete Generierung</h2>
                <span className={`pill ${active.generation.degradations.length ? 'warn' : 'ok'}`}>
                  {active.generation.testMode
                    ? 'TEST_MODE – synthetische Bilder'
                    : active.generation.degradations.length
                      ? `${active.generation.degradations.length} Abweichung(en)`
                      : 'ohne Abweichung'}
                </span>
              </div>
              <table>
                <thead><tr><th>Parameter</th><th>Angefragt</th><th>Tatsächlich</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Modell</td>
                    <td className="mono">{active.generation.requestedModel}</td>
                    <td className="mono">{active.generation.actualModel}</td>
                  </tr>
                  <tr>
                    <td>Qualität <span className="muted">({active.generation.qualitySource})</span></td>
                    <td className="mono">{active.generation.requestedQuality}</td>
                    <td className="mono">{active.generation.actualQuality}</td>
                  </tr>
                  <tr>
                    <td>Größe</td>
                    <td className="mono">{active.generation.requestedSize}</td>
                    <td className="mono">{active.generation.actualSize}</td>
                  </tr>
                  <tr>
                    <td>Provider / Premium</td>
                    <td className="mono">{active.generation.provider}</td>
                    <td className="mono">{active.generation.premium ? 'premium' : 'standard'}</td>
                  </tr>
                </tbody>
              </table>
              {!!active.generation.degradations.length && (
                <table style={{ marginTop: 10 }}>
                  <thead><tr><th>Abweichung</th><th>Grund</th></tr></thead>
                  <tbody>
                    {active.generation.degradations.map((d, i) => (
                      <tr key={i}>
                        <td className="mono">[{d.kind}] {d.requested} → {d.actual}</td>
                        <td className="muted">{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {active.ranking && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="row spread">
                <h2 style={{ margin: 0 }}>Direkter Bildvergleich</h2>
                <span className="pill">{active.ranking.source === 'vision-model' ? 'Bildvergleich durch Vision-Modell' : 'TEST_MODE-Messung'}</span>
              </div>
              <p className="kpi-hint" style={{ marginTop: 6 }}>
                Reihenfolge: {active.ranking.order.map((i) => `#${i}`).join(' > ')} — Sieger #{active.ranking.winner}
              </p>
              <p>{active.ranking.reason}</p>
              {!!active.ranking.perCandidate?.length && (
                <table>
                  <thead><tr><th>Kandidat</th><th>Urteil</th></tr></thead>
                  <tbody>
                    {active.ranking.perCandidate.map((p) => (
                      <tr key={p.index}>
                        <td className="mono">#{p.index}{p.index === active.ranking!.winner ? ' ✓' : ''}</td>
                        <td className="muted">{p.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {active.qa && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="row spread">
                <h2 style={{ margin: 0 }}>Qualitätskontrolle</h2>
                <span className={`pill ${active.qa.passed ? 'ok' : 'warn'}`}>{active.qa.passed ? 'bestanden' : 'mit Hinweisen'}</span>
              </div>
              <table>
                <tbody>
                  {active.qa.checks.map((c) => (
                    <tr key={c.name}>
                      <td style={{ width: 200 }}>{c.name}</td>
                      <td style={{ width: 60 }}>{c.passed ? <span className="pill ok">ok</span> : <span className="pill warn">!</span>}</td>
                      <td className="muted">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!!active.variants?.length && (
            <div className="card" style={{ marginBottom: 18 }}>
              <h2>Varianten</h2>
              <div className="grid cols-2">
                {active.variants.map((v) => (
                  <div key={v.index}>
                    <img
                      className={`thumb ${active.selectedVariant === v.index ? 'selected' : ''}`}
                      src={`${api.fileUrl(v.file.replace(/\.png$/, '.jpg'))}&v=${active.updatedAt}`}
                      alt={`Variante ${v.index}`}
                    />
                    <div className="row spread" style={{ marginTop: 7 }}>
                      <strong style={{ fontSize: 13 }}>
                        Variante {v.index}
                        {active.selectedVariant === v.index ? ' · GEWÄHLT' : ''}
                        {v.rejected ? ' · verworfen' : ''}
                        {v.refined ? ' · verfeinert' : ''}
                      </strong>
                      <span className={`pill ${v.rejected ? 'warn' : ''}`}>{v.critique?.scoreTotal ?? '–'} / 10</span>
                    </div>
                    <div className="kpi-hint">{v.critique?.summary ?? 'keine Bewertung'}</div>
                    {v.rejected && v.rejectionReason && (
                      <div className="kpi-hint" style={{ color: 'var(--warn, #e0a33e)' }}>Verworfen: {v.rejectionReason}</div>
                    )}
                    {v.localQa && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="muted" style={{ cursor: 'pointer' }}>
                          Lokale Qualitätsprüfung: {v.localQa.passed ? 'bestanden' : `${v.localQa.checks.filter((c) => !c.passed).length} Mangel/Mängel`}
                        </summary>
                        <table>
                          <tbody>
                            {v.localQa.checks.map((c) => (
                              <tr key={c.name}>
                                <td style={{ width: 170 }}>{c.name}</td>
                                <td style={{ width: 50 }}>{c.passed ? <span className="pill ok">ok</span> : <span className="pill warn">!</span>}</td>
                                <td className="muted">{c.detail}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    )}
                    {!!v.critique?.reasons?.length && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="muted" style={{ cursor: 'pointer' }}>
                          Begründung der Bewertung ({v.critique.source === 'vision-model' ? 'Bildanalyse' : 'TEST_MODE-Messung'})
                        </summary>
                        <ul className="muted" style={{ margin: '6px 0 0 16px' }}>
                          {v.critique.reasons.map((r, i) => <li key={i}>{r}</li>)}
                          {v.critique.defects.map((d, i) => <li key={`d${i}`}>Mangel: {d}</li>)}
                        </ul>
                        <div className="kpi-hint">
                          Kleinansicht: {v.critique.smallSizeReadable ? 'lesbar' : 'nicht lesbar'} · {v.critique.smallSizeVerdict}
                        </div>
                      </details>
                    )}
                    {v.degradations && v.degradations.length > 0 && (
                      <div className="kpi-hint">
                        Abweichungen: {v.degradations.map((d) => `${d.kind} ${d.requested}→${d.actual}`).join(', ')}
                      </div>
                    )}
                    {v.latencyMs != null && <div className="kpi-hint">Generierungsdauer: {(v.latencyMs / 1000).toFixed(1)}s</div>}
                    <button className="btn" style={{ marginTop: 7 }} disabled={busy}
                      onClick={() => act(() => api.regenerate(active.id, { variant: v.index, resumeFrom: 'generation' }), `Variante ${v.index} neu`)}>
                      Diese Variante neu generieren
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!!active.concepts?.length && (
            <div className="card">
              <h2>Entwickelte Konzepte</h2>
              <table>
                <thead><tr><th>ID</th><th>Strategie</th><th>Konzept</th><th>Idee</th><th>Textbereich</th><th>Score</th></tr></thead>
                <tbody>
                  {active.concepts.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.id}</td>
                      <td className="mono">{c.strategy ?? '–'}</td>
                      <td>{c.label}{c.unusual ? ' ★' : ''}</td>
                      <td className="muted">{c.idea}</td>
                      <td className="mono">{c.textArea}</td>
                      <td>{c.scoreTotal ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
