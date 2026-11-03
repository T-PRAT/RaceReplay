import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Info, ShieldCheck, UserRound, X } from 'lucide-react';
import { COLORS, duration, km, localTime, type LiveTrailRace, type Runner } from './model';
import { calibrate } from './calibration';
import { Brand } from './ImportScreen';
import SourceForm from './SourceForm';
import { ThemeToggle } from './theme';

const choice = (r: { bib: string; name: string }) => `${r.bib} — ${r.name}`;
const correction = (seconds: number) => seconds === 0 ? 'Aucune correction' : `${seconds < 0 ? '−' : '+'}${duration(Math.abs(seconds), true)}`;

export default function Setup({ initial, race, initialTitle, initialMe, busy, error, onLoad, onCancel, onReady }: {
  initial: Runner[]; race: LiveTrailRace | null; initialTitle: string; initialMe?: string; busy: boolean; error: string;
  onLoad: (url: string) => void; onCancel: () => void; onReady: (runners: Runner[], title: string, meId?: string) => void;
}) {
  const [runners, setRunners] = useState(initial), [title, setTitle] = useState(initialTitle), [meId, setMeId] = useState(initialMe);
  const [queries, setQueries] = useState<Record<string, string>>(() => Object.fromEntries(initial.map(r => [r.id, r.official ? choice(r.official) : ''])));
  const update = (id: string, patch: Partial<Runner>) => setRunners(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const assign = (runner: Runner, value: string) => {
    setQueries(q => ({ ...q, [runner.id]: value }));
    const normalize = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const names = race?.entrants.filter(e => normalize(e.name) === normalize(value)) ?? [];
    const official = race?.entrants.find(e => choice(e) === value || e.bib === value.trim()) ?? (names.length === 1 ? names[0] : undefined);
    if (!official || !race) { update(runner.id, { official: undefined, calibration: undefined }); return; }
    const calibration = calibrate(runner, official, race);
    update(runner.id, { official, name: official.name, calibration, offset: calibration.offset });
  };
  const duplicate = new Set(runners.flatMap(r => r.official ? [r.official.bib] : [])).size !== runners.filter(r => r.official).length;
  const valid = race && !duplicate && runners.every(r => r.official && r.calibration?.reliable && Number.isFinite(r.offset) && r.calibration.anchors.every(a => Math.abs(a.officialTime - a.gpsTime - r.offset) <= 120));
  return <>
    <header className="site-header"><Brand /><div className="header-actions"><ThemeToggle /><button className="text-button" onClick={onCancel}><ArrowLeft size={16} />Retour</button></div></header>
    <main className="setup-page">
      <div className="eyebrow">PRÉPARER LE REPLAY <span className="step-tag">ÉTAPE 02 / 02</span></div><h1>Qui était sur la ligne<br />de départ ?</h1>
      <p className="muted">Associez chaque fichier à son dossard LiveTrail, puis indiquez lequel est le vôtre : le replay vous comparera aux autres.</p>
      {!race ? <SourceForm race={race} busy={busy} onLoad={onLoad} /> : <div className="source-summary"><Check size={17} /><div><strong>{race.raceName}</strong><span>Départ officiel : {localTime(race.start, race.timeZone)} · {race.timeZone} · {race.entrants.length} participants</span></div></div>}
      <label className="field title-field">NOM DE L’AVENTURE<input maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label>
      {race && <datalist id="livetrail-entrants">{race.entrants.map(e => <option key={e.bib} value={choice(e)} />)}</datalist>}
      <div className="setup-runners">{runners.map((runner, i) => <section className="setup-runner" key={runner.id}>
        <div className="setup-runner-head"><span className="runner-number" style={{ background: runner.color }}>{String(i + 1).padStart(2, '0')}</span>
          <div className="file-name" title={runner.fileName}>{runner.fileName}<span>{km(runner.points.at(-1)!.distance)} km · {duration(runner.points.at(-1)!.time - runner.points[0].time)} · {runner.points.some(p => p.hr) ? 'Fréquence cardiaque incluse' : 'GPS horodaté'}</span></div>
          <button className={`me-toggle ${meId === runner.id ? 'active' : ''}`} aria-pressed={meId === runner.id} onClick={() => setMeId(id => id === runner.id ? undefined : runner.id)}><UserRound size={14} />C’est moi</button>
          <button className="icon-button" aria-label={`Retirer ${runner.fileName}`} disabled={runners.length <= 2} onClick={() => setRunners(rs => rs.filter(r => r.id !== runner.id))}><X size={16} /></button>
        </div>
        <div className="assignment-fields">
          <label className="field">PARTICIPANT LIVETRAIL · NOM OU DOSSARD
            <input list="livetrail-entrants" autoComplete="off" placeholder="Chercher un nom ou saisir le dossard" value={queries[runner.id] ?? ''} disabled={!race || busy} onChange={e => assign(runner, e.target.value)} />
          </label>
          <div className="field"><span>COULEUR</span><div className="color-picker">{COLORS.slice(0, 6).map(color => <button key={color} type="button" aria-label={`Couleur ${color} pour ${runner.name}`} aria-pressed={runner.color === color} style={{ background: color }} onClick={() => update(runner.id, { color })}>{runner.color === color && <Check size={13} />}</button>)}</div></div>
        </div>
        {runner.official && runner.calibration && <div className={`calibration-status ${runner.calibration.reliable ? '' : 'calibration-warning'}`}>
          {runner.calibration.reliable ? <Check size={15} /> : <Info size={15} />}<div><strong>{runner.official.name} · dossard {runner.official.bib}</strong><span>{correction(runner.offset)}</span><span>{runner.calibration.reliable ? `${runner.calibration.anchors.length} contrôles comparés · écart GPS / pointage typique : ${runner.calibration.spread} s` : runner.calibration.warning}</span></div>
        </div>}
        {runner.calibration && <details className="calibration-details"><summary>Vérifier la synchronisation</summary>
          <p>Une seule correction constante est appliquée. Les pauses et les écarts entre coureurs ne sont pas étirés pour coller aux contrôles.</p>
          <label className="field">CORRECTION DE L’HORLOGE GPS (SECONDES)<input type="number" min={-86400} max={86400} step={1} value={runner.offset} onChange={e => update(runner.id, { offset: Math.max(-86400, Math.min(86400, Number(e.target.value))) })} /></label>
          <div className="table-scroll"><table><thead><tr><th>Contrôle</th><th>LiveTrail</th><th>GPS corrigé</th><th>Différence</th></tr></thead><tbody>{runner.calibration.anchors.map(a => <tr key={a.pointId}><td>{a.name}</td><td>{localTime(a.officialTime, race?.timeZone)}</td><td>{localTime(a.gpsTime + runner.offset, race?.timeZone)}</td><td>{Math.round(a.officialTime - a.gpsTime - runner.offset)} s</td></tr>)}</tbody></table></div>
        </details>}
        {runner.warnings.map(w => <p className="small warning" key={w}>{w}</p>)}
      </section>)}</div>
      {duplicate && <div className="error-box">Un même dossard ne peut pas être associé à deux fichiers.</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="setup-reference"><p className="small muted">Le parcours et les contrôles sont ceux de LiveTrail. Les positions entre contrôles sont estimées avec le GPS ; les portions absentes ne sont pas inventées.</p></div>
      <div className="setup-bottom"><span><ShieldCheck size={16} />Vos FIT ne quittent pas cet onglet</span><button className="button primary" disabled={busy || !valid || !title.trim()} onClick={() => onReady(runners, title.trim(), meId)}>{busy ? 'Construction du replay…' : 'Revoir la course'}<ArrowRight size={17} /></button></div>
    </main>
  </>;
}
