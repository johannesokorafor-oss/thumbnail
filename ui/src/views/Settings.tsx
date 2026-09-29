import { useEffect, useState } from 'react';
import { api } from '../api';

type Cfg = Record<string, unknown>;

const SELECTS: Record<string, string[]> = {
  qualityMode: ['FAST', 'BALANCED', 'MAX'],
  textMode: ['LOCAL_OVERLAY', 'AI_RENDERED', 'BOTH_FOR_COMPARISON'],
  imageProvider: ['openai', 'google'],
  quality: ['max', 'xhigh', 'high', 'medium', 'low'],
  textPosition: ['AUTO', 'LEFT_TEXT', 'RIGHT_TEXT', 'TOP_TEXT', 'BOTTOM_TEXT', 'CENTER_TEXT'],
  stylePreset: ['AUTO', 'CINEMATIC_DOCUMENTARY', 'PHOTOREALISTIC', 'MYSTERIOUS', 'HISTORICAL', 'COSMIC',
    'SCIENTIFIC', 'DARK_LUXURY', 'ANCIENT_MANUSCRIPT', 'SURREAL_SYMBOLIC', 'HIGH_CONTRAST_EDITORIAL',
    'MODERN_DOCUMENTARY', 'EPIC_HISTORICAL'],
};

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Ordner',
    keys: [
      ['inputFolder', 'Input-Ordner'],
      ['outputFolder', 'Output-Ordner'],
      ['archiveFolder', 'Archiv-Ordner'],
      ['failedFolder', 'Fehler-Ordner'],
      ['referenceFolder', 'Referenzbild-Ordner'],
    ],
  },
  {
    title: 'Modelle & Provider',
    keys: [
      ['imageProvider', 'Bild-Provider'],
      ['imageModel', 'Bildmodell'],
      ['fallbackImageModel', 'Fallback-Bildmodell'],
      ['analysisModel', 'Analysemodell'],
      ['analysisModelFallback', 'Fallback-Analysemodell'],
    ],
  },
  {
    title: 'Generierung',
    keys: [
      ['qualityMode', 'Quality Mode'],
      ['quality', 'Bildqualität'],
      ['resolution', 'Auflösung'],
      ['variantCount', 'Anzahl Varianten'],
      ['maxVariantCount', 'Maximale Varianten'],
      ['textMode', 'Text-Modus'],
      ['textPosition', 'Textposition'],
      ['stylePreset', 'Stil-Preset'],
      ['font', 'Schriftart (Overlay)'],
      ['defaultLanguage', 'Sprache'],
    ],
  },
  {
    title: 'Kostenkontrolle & Betrieb',
    keys: [
      ['maxCostPerJob', 'Max. Kosten pro Job (USD)'],
      ['maxDailyCost', 'Max. Kosten pro Tag (USD)'],
      ['testMode', 'TEST_MODE (keine echten API-Kosten)'],
      ['watcherEnabled', 'Ordnerüberwachung aktiv'],
    ],
  },
];

export function Settings({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [profile, setProfile] = useState<Cfg | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.settings().then((s) => {
      setCfg(s.config);
      setProfile(s.channelProfile);
    });
  }, []);

  if (!cfg) return <div className="muted">Lade Einstellungen…</div>;

  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    try {
      await api.saveSettings(cfg, profile ?? undefined);
      setMsg('Einstellungen gespeichert. Watcher wurde neu gestartet.');
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <>
      <h1>Einstellungen</h1>
      <div className="page-sub">Alle Werte überschreiben die Defaults aus der .env und werden lokal gespeichert.</div>
      {msg && <div className="banner">{msg}</div>}

      <div className="banner warn">
        <strong>Datenschutz:</strong> Skripte werden zur KI-Analyse an den konfigurierten AI-Provider übertragen
        (aktuell: {String(cfg.testMode) === 'true' ? 'niemand – TEST_MODE' : String(cfg.imageProvider)}).
        Es werden keine Inhalte an weitere Dienste gesendet. Der API-Key bleibt ausschließlich serverseitig in der .env.
      </div>

      <div className="grid cols-2">
        {GROUPS.map((group) => (
          <div className="card" key={group.title}>
            <h2>{group.title}</h2>
            {group.keys.map(([key, label]) => {
              const value = cfg[key];
              if (typeof value === 'boolean') {
                return (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <select value={String(value)} onChange={(e) => set(key, e.target.value === 'true')}>
                      <option value="true">aktiv</option>
                      <option value="false">inaktiv</option>
                    </select>
                  </div>
                );
              }
              if (SELECTS[key]) {
                return (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <select value={String(value)} onChange={(e) => set(key, e.target.value)}>
                      {SELECTS[key].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                );
              }
              return (
                <div className="field" key={key}>
                  <label>{label}</label>
                  <input
                    value={String(value ?? '')}
                    onChange={(e) => set(key, typeof value === 'number' ? Number(e.target.value) : e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        ))}

        <div className="card">
          <h2>Kanal-Profil (channel-profile.json)</h2>
          <div className="field">
            <label>JSON</label>
            <textarea
              style={{ minHeight: 320 }}
              value={JSON.stringify(profile ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  setProfile(JSON.parse(e.target.value));
                } catch {
                  /* keep typing */
                }
              }}
            />
            <div className="hint">Stil, Farbstimmungen, Textregeln, Markenregeln und verbotene Elemente.</div>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={save}>Speichern</button>
      </div>
    </>
  );
}
