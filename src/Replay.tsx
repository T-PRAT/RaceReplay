import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ChevronDown, ExternalLink, Pause, Play, Plus, RotateCcw, Settings2, TriangleAlert, Users, X } from 'lucide-react';
import { duration, km, localTime, type Project } from './model';
import { saveProject } from './import';
import { cadenceScale, channelMean, climb, detectStops, elevationGain, gradeAdjuster, liveGap, passageAt, projectRunner, raceSummary, recentPace, stateAt, timeAt, zoneStats, type ProjectedRunner } from './race';
import { Brand } from './ImportScreen';
import { ThemeToggle } from './theme';
import StationEditor from './StationEditor';
import OfficialPassings from './OfficialPassings';
import RaceMap from './Map';
import { GapChart, Profile, SliceHeatmap, sliceBounds, Splits, type Range, type Versus } from './Charts';
import { heat, heatDelta, shortGap } from './Heat';
import { AidStations, Summary } from './Stats';

const pace = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds >= 3600) return '—';
  const n = Math.round(seconds);
  return `${Math.floor(n / 60)}′${String(n % 60).padStart(2, '0')}″`;
};
const whole = (n: number) => Number.isFinite(n) ? String(Math.round(n)) : '—';
// Heart rate well above or below the runner's own race average.
const hrTone = (pct: number) => pct >= 105 ? 'is-high' : pct <= 92 ? 'is-low' : '';

type Row = { runner: ProjectedRunner; rank: string; sub: string; gap: string; gapStyle?: CSSProperties; gapClass?: string; gapTitle?: string; hr: number; pct: number; vap: number; dim?: boolean };
function RunnerRows({ rows, meId, averages }: { rows: Row[]; meId?: string; averages?: boolean }) {
  return <div className="rp-runners" role="table" aria-label="Coureurs">
    <div className="rp-row rp-row-head" role="row"><span>#</span><span>Coureur</span><span title={meId ? '− : devant moi · + : derrière moi' : 'Retard sur la tête'}>Écart</span><span title={averages ? 'FC moyenne' : 'Fréquence cardiaque'}>FC</span><span title="Par rapport à sa FC moyenne de course">%FCm</span><span title={averages ? 'Allure ajustée à la pente, moyenne' : 'Allure ajustée à la pente, lissée sur 3 min'}>{averages ? 'VAP' : 'VAP 3′'}</span></div>
    {rows.map(r => <div key={r.runner.id} role="row" className={`rp-row ${r.runner.id === meId ? 'is-me' : ''} ${r.dim ? 'is-dim' : ''}`} style={{ '--runner': r.runner.color } as CSSProperties}>
      <span className="rp-rank">{r.rank}</span>
      <span className="rp-name"><strong>{r.runner.name}</strong><small>{r.sub}</small></span>
      <span className={`rp-gap ${r.gapClass ?? ''}`} style={r.gapStyle} title={r.gapTitle}>{r.gap}</span>
      <span className="rp-num">{whole(r.hr)}</span>
      <span className={`rp-num ${hrTone(r.pct)}`}>{Number.isFinite(r.pct) ? <>{Math.round(r.pct)}<small>%</small></> : '—'}</span>
      <span className="rp-num">{pace(r.vap)}</span>
    </div>)}
  </div>;
}

export default function Replay({ project, onProject, onEdit, onNew }: { project: Project; onProject: (p: Project) => void; onEdit: () => void; onNew: () => void }) {
  const source = project.liveTrail!, meId = project.meId;
  const route = useMemo(() => source.route, [source]);
  const runners = useMemo(() => project.runners.map(r => projectRunner(r, route)), [project.runners, route]);
  const total = route.at(-1)!.distance, gain = useMemo(() => elevationGain(route), [route]);
  const stops = useMemo(() => runners.flatMap(detectStops), [runners]);
  const adjust = useMemo(() => gradeAdjuster(route), [route]);
  // Whole-race figures, also the references for %FC and the cadence unit.
  const summaries = useMemo(() => new Map(runners.map(r => {
    const summary = raceSummary(r, source, adjust, stops);
    return [r.id, { ...summary, hr: Number.isFinite(summary.race.hr) ? summary.race.hr : channelMean(r, 'hr'), cadence: cadenceScale(r) }];
  })), [runners, source, adjust, stops]);
  const [elapsed, setElapsed] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(100);
  const [tab, setTab] = useState('summary'), [editor, setEditor] = useState(false), [versusChoice, setVersus] = useState<Versus>('me');
  const [selection, setSelection] = useState<Range | null>(null), [hover, setHover] = useState<number | null>(null), [panel, setPanel] = useState<'live' | 'zone'>('live');
  const versus: Versus = meId ? versusChoice : 'lead';
  const select = (range: Range | null) => { setSelection(range); setPanel(range ? 'zone' : 'live'); };
  const origin = source.start;
  // Whole seconds, so the slider's last step still reaches finishes timed to the millisecond.
  const end = Math.ceil(Math.max(1, ...runners.map(r => (r.official?.finish ?? r.points.at(-1)!.time + r.offset) - origin)));
  const finish = source.points.at(-1)!;
  const states = runners.map(r => {
    const state = stateAt(r, elapsed, origin);
    // A finish passing is a known position, even if the GPS recording ended early.
    return state.finished && r.official?.finish !== undefined ? { ...state, lat: finish.lat, lon: finish.lon, distance: finish.distance } : state;
  }).sort((a, b) => {
    if (a.pending !== b.pending) return Number(a.pending) - Number(b.pending);
    if (a.finished !== b.finished) return Number(b.finished) - Number(a.finished);
    if (a.finished && b.finished) return (a.runner.official?.finish ?? a.runner.points.at(-1)!.time + a.runner.offset) - (b.runner.official?.finish ?? b.runner.points.at(-1)!.time + b.runner.offset);
    return b.distance - a.distance;
  });
  const leader = states.find(s => !s.pending) ?? states[0];
  const meState = states.find(s => s.runner.id === meId && !s.pending);
  const completePositions = states.every(s => !s.pending);
  const zone = useMemo(() => {
    if (!selection) return null;
    const stats = runners.map(r => zoneStats(r, selection[0], selection[1], source, adjust, stops));
    const finite = (ns: number[]) => ns.filter(Number.isFinite), rank = (t: number) => Number.isFinite(t) ? t : Infinity;
    const best = Math.min(...finite(stats.map(s => s.time))), mine = stats.find(s => s.runner.id === meId && Number.isFinite(s.time));
    const ref = mine ? { time: mine.time, start: mine.start, end: mine.end } : { time: best, start: Math.min(...finite(stats.map(s => s.start))), end: Math.min(...finite(stats.map(s => s.end))) };
    return {
      from: selection[0], to: selection[1], ...climb(route, selection[0], selection[1]), ref, vsMe: !!mine,
      max: Math.max(1, ...finite(stats.map(s => Math.abs(s.time - ref.time)))),
      stats: stats.sort((a, b) => rank(a.time) - rank(b.time) || 0),
    };
  }, [selection, runners, source, adjust, stops, route, meId]);
  const showZone = panel === 'zone' && zone !== null;
  // Where I lost or gained the most against the fastest of the others, slice by slice.
  const moments = useMemo(() => {
    const mine = runners.find(r => r.id === meId), others = runners.filter(r => r.id !== meId);
    if (!mine || !others.length) return [];
    const { bounds } = sliceBounds(total);
    const split = (r: ProjectedRunner, k: number) => { const t = passageAt(r, bounds[k + 1], source) - passageAt(r, bounds[k], source); return t > 0 ? t : NaN; };
    const slices = bounds.slice(1).flatMap((_, k) => {
      const best = others.map(r => ({ r, t: split(r, k) })).filter(o => Number.isFinite(o.t)).sort((a, b) => a.t - b.t)[0], t = split(mine, k);
      return best && Number.isFinite(t) ? [{ range: [bounds[k], bounds[k + 1]] as Range, delta: t - best.t, rival: best.r, ...climb(route, bounds[k], bounds[k + 1]) }] : [];
    }).sort((a, b) => b.delta - a.delta);
    return [...slices.filter(m => m.delta > 0).slice(0, 3), ...slices.filter(m => m.delta < -2).reverse().slice(0, 2)];
  }, [runners, meId, total, source, route]);
  useEffect(() => {
    if (!playing) return;
    let frame: number, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, .5); last = now;
      setElapsed(t => Math.min(end, t + dt * speed)); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, end]);
  useEffect(() => { if (editor || elapsed >= end) setPlaying(false); }, [editor, elapsed, end]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editor) return;
      if (e.code === 'Escape') { setSelection(null); setPanel('live'); return; }
      if ((e.target as HTMLElement).closest('input,select,textarea,button')) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(v => !v); }
      if (e.code === 'ArrowRight') { e.preventDefault(); setElapsed(t => Math.min(end, t + 60)); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); setElapsed(t => Math.max(0, t - 60)); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [end, editor]);
  // Jump to the moment I reach this point, or the first of the group without "me".
  const seekDistance = (distance: number) => {
    const mine = runners.find(r => r.id === meId), at = (r: ProjectedRunner) => timeAt(r, distance) + r.offset;
    const time = mine && Number.isFinite(at(mine)) ? at(mine) : Math.min(...runners.map(at).filter(Number.isFinite));
    if (Number.isFinite(time)) { setElapsed(Math.min(end, Math.max(0, time - origin))); setPlaying(false); }
  };
  const base = meState ?? leader;
  const liveRows: Row[] = states.map((s, i) => {
    const summary = summaries.get(s.runner.id)!, moving = !s.pending && !s.finished && !s.recordingEnded;
    const recent = moving ? recentPace(s.runner, s.time, adjust) : { pace: NaN, adjusted: NaN };
    const hr = moving && s.hr ? s.hr : s.finished ? summary.race.hr : NaN, g = liveGap(s, base, origin + elapsed);
    const cadence = moving && s.cadence ? `${Math.round(s.cadence * summary.cadence)} ppm` : '';
    return {
      runner: s.runner, rank: completePositions ? String(i + 1) : '—', dim: s.pending,
      sub: s.pending ? `GPS dès ${localTime(s.runner.points[0].time + s.runner.offset, source.timeZone)}` : s.finished ? `Arrivé en ${duration(Math.floor(summary.race.time), true)} · moy.` : s.recordingEnded ? 'Fin de trace GPS' : [`${km(s.distance)} km`, `${pace(recent.pace)}/km`, cadence].filter(Boolean).join(' · '),
      gap: s.pending ? '—' : s === base ? meState ? 'moi' : 'tête' : shortGap(meState ? g : Math.max(0, g), !!meState),
      gapClass: meState && s !== base && Number.isFinite(g) ? g < 0 ? 'is-bad' : 'is-good' : undefined,
      hr, pct: hr / summary.hr * 100, vap: moving ? recent.adjusted : s.finished ? summary.race.adjusted : NaN,
    };
  });
  const zoneRows: Row[] = zone ? zone.stats.map((z, i) => {
    const summary = summaries.get(z.runner.id)!, covered = Number.isFinite(z.time), diff = z.time - zone.ref.time, mine = zone.vsMe && z.runner.id === meId;
    return {
      runner: z.runner, rank: covered ? String(i + 1) : '—', dim: !covered,
      sub: covered ? `${duration(z.time, true)} · ${pace(z.pace)}/km${z.stopped ? ` · arrêt ${duration(z.stopped)}` : ''}` : 'Zone non couverte par le GPS',
      gap: !covered ? '—' : mine ? 'moi' : zone.vsMe ? shortGap(diff, true) : diff <= .5 ? 'top' : shortGap(diff),
      gapStyle: !covered || mine ? undefined : zone.vsMe ? heatDelta(diff, zone.max) : heat(diff, zone.max),
      gapTitle: covered ? `Écart ${zone.vsMe ? 'avec moi' : 'au premier'} : entrée ${shortGap(z.start - zone.ref.start, true)} → sortie ${shortGap(z.end - zone.ref.end, true)}` : undefined,
      hr: z.hr, pct: z.hr / summary.hr * 100, vap: z.adjusted,
    };
  }) : [];
  const tabs = [['summary', 'Bilan'], ['gaps', 'Écarts'], ['slices', 'Par tranche'], ['splits', 'Tronçons'], ['points', 'Pointages'], ['aid', 'Ravitos'], ['stations', 'Repères']] as const;
  return <div className="rp-app">
    <header className="rp-header">
      <Brand />
      <div className="rp-race"><strong>{project.title}</strong><span>{new Date(origin * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: source.timeZone })} · {km(total)} km · {gain.toLocaleString('fr-FR')} m D+ · <a href={source.url} target="_blank" rel="noreferrer">LiveTrail<ExternalLink size={10} /></a></span>{runners.some(r => r.offCourse > .1) && <span className="rp-warn" title="Une trace s’écarte du parcours officiel : positions et écarts GPS moins fiables."><TriangleAlert size={13} />trace hors parcours</span>}</div>
      <label className="rp-me"><span>Je suis</span><select value={meId ?? ''} onChange={e => onProject({ ...project, meId: e.target.value || undefined })}><option value="">Spectateur</option>{project.runners.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select><ChevronDown size={13} /></label>
      <div className="rp-actions">
        <button className="icon-button" title="Participants et horloges" aria-label="Participants et horloges" onClick={onEdit}><Users size={17} /></button>
        <button className="icon-button" title="Exporter le replay" aria-label="Exporter le replay" onClick={() => saveProject(project)}><ArrowDownToLine size={17} /></button>
        <ThemeToggle />
        <button className="icon-button" title="Nouveau replay" aria-label="Nouveau replay" onClick={onNew}><Plus size={17} /></button>
      </div>
    </header>
    <main className="rp">
      <section className="rp-card rp-main">
        <div className="rp-map"><RaceMap route={route} states={states} stations={project.stations} selection={selection} hover={hover} meId={meId} /></div>
        <aside className="rp-side">
          <div className="rp-side-head">
            <h2>{showZone ? `Zone ${km(zone.from)} → ${km(zone.to)} km` : completePositions ? 'En course' : 'En course · départs GPS manquants'}</h2>
            {selection && <div className="segmented" role="group" aria-label="Affichage"><button className={panel === 'live' ? 'active' : ''} aria-pressed={panel === 'live'} onClick={() => setPanel('live')}>Direct</button><button className={panel === 'zone' ? 'active' : ''} aria-pressed={panel === 'zone'} onClick={() => setPanel('zone')}>Zone</button></div>}
          </div>
          <div className="rp-side-body">
            <RunnerRows rows={showZone ? zoneRows : liveRows} meId={meId} averages={showZone} />
            {!showZone && moments.length > 0 && <div className="rp-moments"><h3>Mes moments clés <small>face au plus rapide des autres</small></h3>
              {moments.map(m => <button key={m.range[0]} className={m.delta > 0 ? 'is-loss' : 'is-gain'} onClick={() => select(m.range)} title="Analyser cette zone">
                <span>{km(m.range[0])}–{km(m.range[1])} km</span><small>D+ {m.up} · D− {m.down}</small><b>{m.delta > 0 ? 'perdu' : 'gagné'} {shortGap(m.delta).slice(1)}</b><em>sur {m.rival.name.split(' ')[0]}</em>
              </button>)}
            </div>}
          </div>
          {!meId && <p className="rp-side-note">Choisis « Je suis » en haut pour te comparer aux autres.</p>}
        </aside>
        <div className="rp-profile">
          <div className="rp-profile-head">{zone
            ? <><strong>{km(zone.from)} → {km(zone.to)} km</strong><span>{km(zone.to - zone.from)} km · D+ {zone.up} m · D− {zone.down} m</span><button className="text-button" onClick={() => select(null)} title="Effacer la zone (Échap)"><X size={13} />Effacer</button></>
            : <span>Glisser sur le profil : analyser une zone · Clic : aller au point</span>}</div>
          <Profile route={route} states={states} stations={project.stations} selection={selection} hover={hover} meId={meId} onSeek={seekDistance} onSelect={select} onHover={setHover} />
        </div>
        <div className="rp-play">
          <button className="icon-button" aria-label="Revenir au départ" onClick={() => { setElapsed(0); setPlaying(false); }}><RotateCcw size={15} /></button>
          <button className="play-button" aria-label={playing ? 'Mettre en pause' : 'Lancer le replay'} title="Espace · ← → : ±1 min" onClick={() => { if (elapsed >= end) setElapsed(0); setPlaying(p => !p); }}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          <div className="rp-clock"><strong>{duration(elapsed, true)}</strong><span>{localTime(origin + elapsed, source.timeZone)}</span></div>
          <input className="rp-timeline" type="range" aria-label="Position dans le replay" min={0} max={end} step={1} value={elapsed} aria-valuetext={duration(elapsed, true)} style={{ '--progress': `${elapsed / end * 100}%` } as CSSProperties} onChange={e => { setElapsed(Number(e.target.value)); setPlaying(false); }} />
          <span className="rp-end">{duration(end, true)}</span>
          <label className="speed-picker"><span className="sr-only">Vitesse de lecture</span><select value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 10, 30, 60, 100, 300, 600].map(v => <option key={v} value={v}>×{v}</option>)}</select><ChevronDown size={12} /></label>
        </div>
      </section>
      <section className="rp-card rp-analysis">
        <div className="rp-tabs" role="tablist" aria-label="Analyses">
          {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}{id === 'stations' && <span className="count">{project.stations.length}</span>}</button>)}
          <div className="rp-tabs-tools">
            {tab === 'stations' ? <button className="text-button" onClick={() => setEditor(true)}><Settings2 size={13} />Modifier</button>
              : meId && <div className="segmented" role="group" aria-label="Comparer à"><button className={versus === 'me' ? 'active' : ''} aria-pressed={versus === 'me'} onClick={() => setVersus('me')}>vs moi</button><button className={versus === 'lead' ? 'active' : ''} aria-pressed={versus === 'lead'} onClick={() => setVersus('lead')}>vs tête</button></div>}
          </div>
        </div>
        <div className="rp-analysis-body">
          {tab === 'summary' && <Summary runners={runners} summaries={summaries} source={source} meId={meId} versus={versus} />}
          {tab === 'aid' && <AidStations runners={runners} summaries={summaries} source={source} stops={stops} meId={meId} versus={versus} onSeek={seekDistance} />}
          {tab === 'gaps' && <GapChart runners={runners} meId={meId} versus={versus} stations={project.stations} selection={selection} total={total} onSeek={seekDistance} onHover={setHover} />}
          {tab === 'slices' && <SliceHeatmap runners={runners} source={source} meId={meId} versus={versus} selection={selection} onSelect={select} />}
          {tab === 'splits' && <Splits runners={runners} stations={project.stations} total={total} source={source} meId={meId} versus={versus} selection={selection} onSelect={select} />}
          {tab === 'points' && <OfficialPassings source={source} runners={runners} meId={meId} versus={versus} />}
          {tab === 'stations' && <div className="rp-stations">{project.stations.map((s, i) => <button key={s.id} onClick={() => seekDistance(s.distance)}><span>{i + 1}</span><strong>{s.name}</strong><em>{km(s.distance)} km</em><small>{s.official ? 'LiveTrail' : 'manuel'}</small></button>)}</div>}
        </div>
      </section>
    </main>
    {editor && <StationEditor stations={project.stations} total={total} onChange={stations => onProject({ ...project, stations })} onClose={() => setEditor(false)} />}
  </div>;
}

