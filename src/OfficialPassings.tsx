import { duration, km, localTime, type LiveTrailSource, type Runner } from './model';
import { heat, heatDelta, HeatLegend, shortGap } from './Heat';
import type { Versus } from './Charts';

// Official LiveTrail arrival times, with the cumulative gap to me or to the first of the group.
export default function OfficialPassings({ source, runners, meId, versus }: { source: LiveTrailSource; runners: Runner[]; meId?: string; versus: Versus }) {
  const columns = [...runners].sort((a, b) => Number(b.id === meId) - Number(a.id === meId));
  const mine = columns.findIndex(r => r.id === meId), vsMe = versus === 'me' && mine >= 0;
  const rows = source.points.slice(1).map(point => {
    const times = columns.map(r => r.official?.passings.find(p => p.pointId === point.id)?.time ?? NaN);
    const reference = vsMe ? times[mine] : Math.min(...times.filter(Number.isFinite));
    return { point, times, diffs: times.map(t => t - reference) };
  });
  const max = Math.max(1, ...rows.flatMap(r => r.diffs).filter(Number.isFinite).map(Math.abs));
  return <div className="analysis-table">
    <div className="analysis-caption"><span>Pointages LiveTrail · écart cumulé {vsMe ? 'avec moi' : 'au premier du groupe'}</span><HeatLegend max={max} versus={vsMe} /></div>
    <div className="table-scroll"><table className="rp-table heat-table"><thead><tr><th>Contrôle</th><th className="num">km</th>{columns.map(r => <th key={r.id} className={r.id === meId ? 'is-me' : ''}><i className="runner-dot" style={{ background: r.color }} />{r.name}</th>)}</tr></thead>
      <tbody>{rows.map(({ point, times, diffs }) => <tr key={point.id}><th scope="row">{point.name}</th><td className="num muted">{km(point.distance)}</td>{columns.map((r, i) => {
        const me = vsMe && i === mine, t = times[i];
        return <td key={r.id} className="heat-cell" style={me ? undefined : vsMe ? heatDelta(diffs[i], max) : heat(diffs[i], max)} title={Number.isFinite(t) ? `${localTime(t, source.timeZone)} · ${duration(Math.floor(t - r.official!.start), true)} de course` : undefined}>
          <b>{Number.isFinite(t) ? duration(Math.floor(t - r.official!.start), true) : '—'}</b><small>{!Number.isFinite(t) ? 'non pointé' : me ? 'moi' : vsMe ? shortGap(diffs[i], true) : diffs[i] <= .5 ? 'premier' : shortGap(diffs[i])}</small>
        </td>;
      })}</tr>)}</tbody>
    </table></div>
  </div>;
}
