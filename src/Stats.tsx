import { useMemo, type ReactNode } from 'react';
import { clock, km, type LiveTrailSource } from './model';
import { aidStops, type ProjectedRunner, type RaceSummary, type Stop } from './race';
import { heat, heatDelta, HeatLegend } from './Heat';
import type { Versus } from './Charts';

type Summary = RaceSummary & { hr: number; cadence: number };
const pace = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds >= 3600) return '—';
  const n = Math.round(seconds);
  return `${Math.floor(n / 60)}′${String(n % 60).padStart(2, '0')}″`;
};
const whole = (n: number) => Number.isFinite(n) ? String(Math.round(n)) : '—';
const ordered = (runners: ProjectedRunner[], meId?: string) => [...runners].sort((a, b) => Number(b.id === meId) - Number(a.id === meId));

// One value per runner. `score` drives the colour: lower is better unless `better` is 'high'.
type Cell = { text: ReactNode; sub?: ReactNode; score?: number };
type Line = { label: string; hint?: string; better?: 'low' | 'high'; cells: Cell[] };

function useColour(versus: Versus, mine: number) {
  return (line: Line) => {
    const scores = line.cells.map(c => line.better && c.score !== undefined && Number.isFinite(c.score) ? c.score : NaN);
    // Positive = worse than the reference; that is "time lost" in both modes.
    const worse = (s: number, ref: number) => line.better === 'high' ? ref - s : s - ref;
    if (versus === 'me' && mine >= 0) {
      const max = Math.max(1e-9, ...scores.filter(Number.isFinite).map(s => Math.abs(worse(s, scores[mine]))));
      return scores.map((s, i) => i === mine || !Number.isFinite(s) ? undefined : heatDelta(worse(s, scores[mine]), max));
    }
    const finite = scores.filter(Number.isFinite), best = line.better === 'high' ? Math.max(...finite) : Math.min(...finite);
    const max = Math.max(1e-9, ...finite.map(s => worse(s, best)));
    return scores.map(s => Number.isFinite(s) ? heat(worse(s, best) / max * 100, 100) : undefined);
  };
}

// One row per runner, one column per figure, so a whole race fits a wide screen.
function StatTable({ caption, columns, lines, meId, versus }: { caption: ReactNode; columns: ProjectedRunner[]; lines: Line[]; meId?: string; versus: Versus }) {
  const mine = columns.findIndex(r => r.id === meId), colour = useColour(versus, versus === 'me' ? mine : -1), styles = lines.map(colour);
  return <div className="analysis-table">
    <div className="analysis-caption"><span>{caption}</span><HeatLegend versus={versus === 'me' && mine >= 0} labels={versus === 'me' && mine >= 0 ? ['mieux que moi', 'moins bien'] : ['meilleur', 'moins bon']} /></div>
    <div className="table-scroll"><table className="rp-table heat-table stat-table"><thead><tr><th>Coureur</th>{lines.map(l => <th key={l.label} title={l.hint}>{l.label}</th>)}</tr></thead>
      <tbody>{columns.map((r, i) => <tr key={r.id} className={r.id === meId ? 'is-me' : ''}><th scope="row"><i className="runner-dot" style={{ background: r.color }} />{r.name}</th>{lines.map((l, k) => <td key={l.label} className="heat-cell" style={styles[k][i]}><b>{l.cells[i].text}</b>{l.cells[i].sub !== undefined && <small>{l.cells[i].sub}</small>}</td>)}</tr>)}</tbody>
    </table></div>
  </div>;
}

// Overall figures for the whole race.
export function Summary({ runners, summaries, source, meId, versus }: { runners: ProjectedRunner[]; summaries: Map<string, Summary>; source: LiveTrailSource; meId?: string; versus: Versus }) {
  const columns = ordered(runners, meId), s = columns.map(r => summaries.get(r.id)!);
  const rate = (vertical: number, time: number) => time > 60 ? vertical / time * 3600 : NaN;
  const lines: Line[] = [
    { label: 'Temps officiel', better: 'low', cells: s.map((x, i) => ({ text: clock(Math.floor(x.race.time)), sub: columns[i].official?.rank ? `${columns[i].official!.rank === 1 ? '1er' : `${columns[i].official!.rank}e`}${source.finishers ? ` / ${source.finishers}` : ''}` : 'classement inconnu', score: x.race.time })) },
    { label: 'En mouvement', hint: 'Temps officiel moins les arrêts GPS', better: 'low', cells: s.map(x => ({ text: clock(x.moving), sub: `${whole(x.moving / x.race.time * 100)} % du temps`, score: x.moving })) },
    { label: 'Arrêts', hint: 'Immobile au moins 10 s (GPS), hors départ et arrivée. Détail dans l’onglet Ravitos', better: 'low', cells: s.map(x => ({ text: clock(x.stopped), sub: `${x.stopCount} · dont ravitos ${clock(x.aid)}`, score: x.stopped })) },
    { label: 'Allure · VAP', hint: 'Moyennes sur toute la course, arrêts inclus', better: 'low', cells: s.map(x => ({ text: `${pace(x.race.pace)} · ${pace(x.race.adjusted)}`, sub: '/km', score: x.race.adjusted })) },
    { label: 'Montées', hint: 'Pente > 5 %, en mouvement : vitesse ascensionnelle (VAM), allure et temps passé', better: 'high', cells: s.map(x => ({ text: `${whole(rate(x.terrain.climb.vertical, x.terrain.climb.time))} m/h`, sub: `${pace(x.terrain.climb.time / x.terrain.climb.distance * 1000)}/km · ${clock(x.terrain.climb.time)}`, score: rate(x.terrain.climb.vertical, x.terrain.climb.time) })) },
    { label: 'Descentes', hint: 'Pente < −5 %, en mouvement : allure, dénivelé descendu par heure et temps passé', better: 'low', cells: s.map(x => ({ text: `${pace(x.terrain.descent.time / x.terrain.descent.distance * 1000)}/km`, sub: `${whole(rate(x.terrain.descent.vertical, x.terrain.descent.time))} m/h · ${clock(x.terrain.descent.time)}`, score: x.terrain.descent.time / x.terrain.descent.distance })) },
    { label: 'Plat', hint: 'Pente entre −5 % et +5 %, en mouvement', better: 'low', cells: s.map(x => ({ text: `${pace(x.terrain.flat.time / x.terrain.flat.distance * 1000)}/km`, sub: clock(x.terrain.flat.time), score: x.terrain.flat.time / x.terrain.flat.distance })) },
    { label: 'VAP 1re → 2e ½', hint: 'Allure ajustée à la pente de chaque moitié du parcours : moins elle se dégrade, mieux la course est gérée', better: 'low', cells: s.map(x => { const drift = x.halves[1].adjusted / x.halves[0].adjusted - 1; return { text: `${pace(x.halves[0].adjusted)} → ${pace(x.halves[1].adjusted)}`, sub: !Number.isFinite(drift) ? '—' : Math.round(drift * 100) === 0 ? 'stable' : `${drift > 0 ? '+' : '−'}${Math.abs(Math.round(drift * 100))} %`, score: drift }; }) },
    { label: 'FC moy. · max', hint: 'Max : la plus haute moyenne sur 15 points, pour ignorer les pics du capteur', cells: s.map(x => ({ text: `${whole(x.race.hr)} · ${whole(x.hrMax)}`, sub: 'bpm' })) },
    { label: 'FC 1re → 2e ½', hint: 'FC moyenne sur chaque moitié du parcours', cells: s.map(x => { const d = Math.round(x.halves[1].hr - x.halves[0].hr); return { text: `${whole(x.halves[0].hr)} → ${whole(x.halves[1].hr)}`, sub: !Number.isFinite(d) ? '—' : d === 0 ? 'stable' : `${d > 0 ? '+' : '−'}${Math.abs(d)} bpm` }; }) },
    { label: 'Cadence', cells: s.map(x => ({ text: whole(x.race.cadence), sub: 'pas/min' })) },
  ];
  return <StatTable caption={`Toute la course · arrêts mesurés au GPS${versus === 'me' && meId ? ' · couleurs par rapport à moi' : ''}`} columns={columns} lines={lines} meId={meId} versus={versus} />;
}

// Time stopped at each aid station, then elsewhere.
export function AidStations({ runners, summaries, source, stops, meId, versus, onSeek }: { runners: ProjectedRunner[]; summaries: Map<string, Summary>; source: LiveTrailSource; stops: Stop[]; meId?: string; versus: Versus; onSeek: (distance: number) => void }) {
  const columns = ordered(runners, meId);
  const aid = useMemo(() => ordered(runners, meId).map(r => aidStops(r, source, stops)), [runners, meId, source, stops]);
  const lines: Line[] = [
    ...source.points.filter(p => p.aid).map((point, k) => ({
      label: point.name, better: 'low' as const,
      cells: aid.map(a => a[k].reached ? { text: clock(a[k].stopped), sub: a[k].mats !== undefined ? `tapis ${clock(a[k].mats!)}` : ' ', score: a[k].stopped } : { text: '—', sub: 'non pointé' }),
    })),
    { label: 'Autres arrêts', hint: 'Arrêts GPS hors des ravitos', better: 'low', cells: columns.map(r => { const x = summaries.get(r.id)!; return { text: clock(x.stopped - x.aid), sub: `${x.stopCount} arrêt${x.stopCount > 1 ? 's' : ''} au total`, score: x.stopped - x.aid }; }) },
    { label: 'Total', better: 'low', cells: columns.map(r => { const x = summaries.get(r.id)!; return { text: clock(x.stopped), sub: `ravitos ${clock(x.aid)}`, score: x.stopped }; }) },
  ];
  const kms = new Map(source.points.map(p => [p.name, p.distance]));
  return <AidTable lines={lines} kms={kms} columns={columns} meId={meId} versus={versus} onSeek={onSeek} />;
}

function AidTable({ lines, kms, columns, meId, versus, onSeek }: { lines: Line[]; kms: Map<string, number>; columns: ProjectedRunner[]; meId?: string; versus: Versus; onSeek: (distance: number) => void }) {
  const mine = columns.findIndex(r => r.id === meId), colour = useColour(versus, versus === 'me' ? mine : -1), styles = lines.map(colour);
  return <div className="analysis-table">
    <div className="analysis-caption"><span>Temps immobile à moins de 200 m du ravito (GPS) · « tapis » : entrée → sortie LiveTrail, quand les deux sont lus · cliquer un ravito pour le revoir</span><HeatLegend versus={versus === 'me' && mine >= 0} labels={versus === 'me' && mine >= 0 ? ['plus court que moi', 'plus long'] : ['plus court', 'plus long']} /></div>
    <div className="table-scroll"><table className="rp-table heat-table stat-table"><thead><tr><th>Coureur</th>{lines.map(l => { const d = kms.get(l.label); return <th key={l.label} title={l.hint} className={d === undefined ? 'is-total' : ''}>{d !== undefined ? <button className="split-select" title="Revoir l’arrivée au ravito" onClick={() => onSeek(d)}>{l.label} <span className="muted">{km(d)} km</span></button> : l.label}</th>; })}</tr></thead>
      <tbody>{columns.map((r, i) => <tr key={r.id} className={r.id === meId ? 'is-me' : ''}><th scope="row"><i className="runner-dot" style={{ background: r.color }} />{r.name}</th>{lines.map((l, k) => <td key={l.label} className={`heat-cell ${kms.has(l.label) ? '' : 'is-total'}`} style={styles[k][i]}><b>{l.cells[i].text}</b>{l.cells[i].sub !== undefined && <small>{l.cells[i].sub}</small>}</td>)}</tr>)}</tbody>
    </table></div>
  </div>;
}
