import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LiveTrailSource, RoutePoint, Station } from './model';
import { duration, km } from './model';
import { passageAt, routePosition, timeAt, type ProjectedRunner, type stateAt } from './race';
import { heat, heatDelta, HeatLegend, shortGap } from './Heat';

export type Range = [number, number];
// Comparisons are made against "me" (the selected runner) or the head of the group.
export type Versus = 'me' | 'lead';

function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 160 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(250, entry.contentRect.width), height: Math.max(60, entry.contentRect.height) }));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
function kmTicks(total: number, width: number) {
  const step = [1000, 2000, 5000, 10000, 20000, 50000].find(s => total / s <= width / 75) ?? 100000;
  return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
}
const ordered = (runners: ProjectedRunner[], meId?: string) => [...runners].sort((a, b) => Number(b.id === meId) - Number(a.id === meId));

export function Profile({ route, states, stations, selection, hover, meId, onSeek, onSelect, onHover }: {
  route: RoutePoint[]; states: ReturnType<typeof stateAt>[]; stations: Station[]; selection: Range | null; hover: number | null; meId?: string;
  onSeek: (distance: number) => void; onSelect: (range: Range) => void; onHover: (distance: number | null) => void;
}) {
  const id = useId().replace(/:/g, '');
  const { ref, width, height } = useChartSize();
  const pad = 14, top = 16, base = height - 14, max = route.at(-1)!.distance;
  const [low, high] = useMemo(() => [Math.min(...route.map(p => p.alt)), Math.max(...route.map(p => p.alt))], [route]);
  const x = (d: number) => pad + d / max * (width - pad * 2), y = (a: number) => base - (a - low) / (high - low || 1) * (base - top - 4);
  const line = (from = 0, to = max) => route.filter(p => p.distance >= from && p.distance <= to).map(p => `${x(p.distance).toFixed(1)},${y(p.alt).toFixed(1)}`).join(' ');
  const points = useMemo(() => line(), [route, width, height, low, high]);
  const [draft, setDraft] = useState<{ from: number; clientX: number; to?: number } | null>(null);
  const toDistance = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(max, ((e.clientX - box.left) / box.width * width - pad) / (width - 2 * pad) * max));
  };
  // Zone edges snap to the start, the finish and the checkpoints within 8 px.
  const snap = (d: number) => {
    const near = [0, max, ...stations.map(s => s.distance)].reduce((best, m) => Math.abs(m - d) < Math.abs(best - d) ? m : best);
    return Math.abs(x(near) - x(d)) <= 8 ? near : d;
  };
  const shown = draft?.to !== undefined ? [Math.min(draft.from, draft.to), Math.max(draft.from, draft.to)] : selection;
  const hovered = hover === null ? null : routePosition(route, hover);
  return <div className="profile-wrap" ref={ref}><svg className="profile" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Profil altimétrique : glisser pour analyser une zone, cliquer pour se placer dans le replay"
    onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDraft({ from: snap(toDistance(e)), clientX: e.clientX }); }}
    onPointerMove={e => { const d = toDistance(e); onHover(d); if (draft) setDraft({ ...draft, to: Math.abs(e.clientX - draft.clientX) > 6 ? snap(d) : undefined }); }}
    onPointerUp={e => {
      if (!draft) return;
      if (draft.to !== undefined && Math.abs(draft.to - draft.from) >= 50) onSelect([Math.min(draft.from, draft.to), Math.max(draft.from, draft.to)]);
      else onSeek(toDistance(e));
      setDraft(null); if (e.pointerType !== 'mouse') onHover(null);
    }}
    onPointerCancel={() => { setDraft(null); onHover(null); }} onPointerLeave={() => { if (!draft) onHover(null); }}>
    <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" className="profile-fill-top" /><stop offset="100%" className="profile-fill-bottom" /></linearGradient></defs>
    <polygon points={`${pad},${base} ${points} ${width - pad},${base}`} fill={`url(#${id})`} />
    <polyline points={points} className="profile-line" />
    {shown && <g>
      <rect x={x(shown[0])} y={top} width={Math.max(1, x(shown[1]) - x(shown[0]))} height={base - top} className="zone-fill" />
      <polyline points={line(shown[0], shown[1])} className="profile-zone-line" />
      {shown.map(d => <line key={d} x1={x(d)} x2={x(d)} y1={top} y2={base} className="zone-edge" />)}
    </g>}
    {stations.map(s => <g key={s.id}><line x1={x(s.distance)} x2={x(s.distance)} y1={top} y2={base} className="chart-mark" /><text x={x(s.distance)} y={11} textAnchor="middle" className="chart-label">{s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}<title>{s.name} · {km(s.distance)} km</title></text></g>)}
    <text x={width - pad} y={y(high) - 3} textAnchor="end" className="chart-label">{Math.round(high)} m</text>
    <text x={width - pad} y={base - 3} textAnchor="end" className="chart-label">{Math.round(low)} m</text>
    {hovered && hover !== null && <g>
      <line x1={x(hover)} x2={x(hover)} y1={top} y2={base} className="chart-cursor" />
      <circle cx={x(hover)} cy={y(hovered.alt)} r="3.5" className="chart-cursor-dot" />
      <text x={x(hover) + (x(hover) > width - 110 ? -7 : 7)} y={top + 10} textAnchor={x(hover) > width - 110 ? 'end' : 'start'} className="chart-label chart-cursor-label">{km(hover)} km · {Math.round(hovered.alt)} m</text>
    </g>}
    {states.filter(s => !s.pending).sort((a, b) => Number(a.runner.id === meId) - Number(b.runner.id === meId)).map(s => { const p = routePosition(route, s.distance); return <circle key={s.runner.id} cx={x(s.distance)} cy={y(p.alt)} r={s.runner.id === meId ? 6 : 4.5} fill={s.runner.color} className="chart-runner"><title>{s.runner.name} · {km(s.distance)} km</title></circle>; })}
    {kmTicks(max, width).map(d => <text key={d} x={x(d)} y={height - 3} textAnchor="middle" className="chart-label">{km(d)}</text>)}
  </svg></div>;
}

function niceSeconds(range: number, ticks: number) {
  return [15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200].find(s => range / s <= ticks) ?? 14400;
}
const tickLabel = (v: number) => {
  const n = Math.abs(v), sign = v < 0 ? '−' : '+';
  return n < 60 ? `${sign}${n} s` : n < 3600 ? `${sign}${n / 60} min` : `${sign}${Math.floor(n / 3600)} h${n % 3600 ? String(n % 3600 / 60).padStart(2, '0') : ''}`;
};

// Time gap at the same point of the course. Ahead is drawn up, behind down.
export function GapChart({ runners, meId, versus, stations, selection, total, onSeek, onHover }: { runners: ProjectedRunner[]; meId?: string; versus: Versus; stations: Station[]; selection: Range | null; total: number; onSeek: (distance: number) => void; onHover: (distance: number | null) => void }) {
  const { ref, width, height } = useChartSize();
  const [cursor, setCursor] = useState<number | null>(null);
  const series = useMemo(() => {
    const ds = Array.from({ length: 241 }, (_, i) => total * i / 240);
    const times = runners.map(r => ds.map(d => timeAt(r, d) + r.offset));
    const mine = runners.findIndex(r => r.id === meId);
    const reference = ds.map((_, k) => versus === 'me' && mine >= 0 ? times[mine][k] : Math.min(...times.map(t => t[k]).filter(Number.isFinite)));
    return { ds, values: times.map(t => t.map((time, k) => time - reference[k])) };
  }, [runners, meId, versus, total]);
  const left = 54, right = 10, top = 8, bottom = height - 18;
  const all = series.values.flat().filter(Number.isFinite);
  const step = niceSeconds(Math.max(60, ...all) - Math.min(0, ...all), Math.max(2, Math.floor((bottom - top) / 34)));
  const lo = Math.floor(Math.min(0, ...all) / step) * step, hi = Math.max(step, Math.ceil(Math.max(0, ...all) / step) * step);
  const x = (d: number) => left + d / total * (width - left - right), y = (v: number) => top + (v - lo) / (hi - lo) * (bottom - top);
  const toDistance = (e: React.MouseEvent<SVGSVGElement>) => { const b = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(total, ((e.clientX - b.left) / b.width * width - left) / (width - left - right) * total)); };
  const k = cursor === null ? -1 : Math.round(cursor / total * 240);
  const rows = k < 0 ? [] : runners.map((r, i) => ({ r, v: series.values[i][k] })).filter(row => Number.isFinite(row.v)).sort((a, b) => a.v - b.v);
  const label = versus === 'me' ? 'moi' : 'tête';
  return <div className="gap-chart" ref={ref}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Écarts au même point du parcours par rapport à ${versus === 'me' ? 'moi' : 'la tête du groupe'}`} onClick={e => onSeek(toDistance(e))} onMouseMove={e => { const d = toDistance(e); setCursor(d); onHover(d); }} onMouseLeave={() => { setCursor(null); onHover(null); }}>
      {selection && <rect x={x(selection[0])} y={top} width={x(selection[1]) - x(selection[0])} height={bottom - top} className="zone-fill" />}
      {stations.map(s => <line key={s.id} x1={x(s.distance)} x2={x(s.distance)} y1={top} y2={bottom} className="chart-mark" />)}
      {Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step).map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className={v === 0 ? 'chart-zero' : 'chart-grid'} /><text x={left - 6} y={y(v) + 3} textAnchor="end" className="chart-label">{v === 0 ? label : tickLabel(v)}</text></g>)}
      {runners.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.id === meId) - Number(b.r.id === meId)).map(({ r, i }) => <polyline key={r.id} fill="none" stroke={r.color} strokeWidth={r.id === meId ? 2.8 : 1.6} strokeOpacity={r.id === meId ? 1 : .85} points={series.ds.map((d, j) => Number.isFinite(series.values[i][j]) ? `${x(d).toFixed(1)},${y(series.values[i][j]).toFixed(1)}` : '').filter(Boolean).join(' ')} />)}
      {kmTicks(total, width).map(d => <text key={d} x={x(d)} y={height - 4} textAnchor="middle" className="chart-label">{km(d)} km</text>)}
      {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={top} y2={bottom} className="chart-cursor" />}
    </svg>
    <span className="gap-chart-axis">↑ devant · ↓ derrière {versus === 'me' ? 'moi' : 'la tête'}</span>
    {cursor !== null && rows.length > 0 && <div className={`chart-tip ${x(cursor) > width - 200 ? 'flip' : ''}`} style={{ left: x(cursor) }}>
      <strong>{km(cursor)} km</strong>
      {rows.map(({ r, v }) => <span key={r.id} className={r.id === meId ? 'is-me' : ''}><i style={{ background: r.color }} />{r.name}<b>{Math.abs(v) < .5 ? '=' : shortGap(v, true)}</b></span>)}
    </div>}
  </div>;
}

// Even slices of 1 to 10 km, at most 24; a short last slice joins the previous one.
export function sliceBounds(total: number) {
  const step = [1000, 2000, 3000, 5000, 10000].find(s => total / s <= 24) ?? 20000;
  const b = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  if (total - b.at(-1)! < step / 3 && b.length > 1) b.pop();
  return { step, bounds: [...b, total] };
}
function useSlices(total: number) {
  return useMemo(() => sliceBounds(total), [total]);
}

// Time on each slice of the course, against me or against the fastest of the group.
export function SliceHeatmap({ runners, source, meId, versus, selection, onSelect }: { runners: ProjectedRunner[]; source: LiveTrailSource; meId?: string; versus: Versus; selection: Range | null; onSelect: (range: Range) => void }) {
  const { step, bounds } = useSlices(source.route.at(-1)!.distance);
  const rows = useMemo(() => ordered(runners, meId), [runners, meId]);
  const times = useMemo(() => rows.map(r => {
    const t = bounds.map(d => passageAt(r, d, source));
    return bounds.slice(1).map((_, k) => t[k + 1] - t[k] > 0 ? t[k + 1] - t[k] : NaN);
  }), [rows, bounds, source]);
  const mine = rows.findIndex(r => r.id === meId), vsMe = versus === 'me' && mine >= 0;
  const reference = bounds.slice(1).map((_, k) => vsMe ? times[mine][k] : Math.min(...times.map(t => t[k]).filter(Number.isFinite)));
  const diffs = times.map(t => t.map((v, k) => v - reference[k]));
  const max = Math.max(1, ...diffs.flat().filter(Number.isFinite).map(Math.abs));
  return <div className="analysis-table">
    <div className="analysis-caption"><span>Par tranche de {km(step)} km · cliquer une case pour l’analyser</span><HeatLegend max={max} versus={vsMe} /></div>
    <div className="table-scroll"><table className="rp-table heat-table slices"><thead><tr><th>km</th>{bounds.slice(1).map((d, k) => <th key={d}>{km(bounds[k])}–{km(d)}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id} className={r.id === meId ? 'is-me' : ''}><th scope="row"><i className="runner-dot" style={{ background: r.color }} />{r.name}</th>{diffs[i].map((v, k) => {
        const me = vsMe && i === mine, active = selection?.[0] === bounds[k] && selection[1] === bounds[k + 1];
        const text = !Number.isFinite(v) ? '—' : me ? duration(times[i][k], true).replace(/^0:/, '') : vsMe ? shortGap(v, true) : v <= .5 ? 'top' : shortGap(v);
        return <td key={k} className={`heat-cell ${active ? 'is-active' : ''}`} style={me ? undefined : vsMe ? heatDelta(v, max) : heat(v, max)}><button title={`${r.name} · ${km(bounds[k])} → ${km(bounds[k + 1])} km · ${duration(times[i][k], true)}`} onClick={() => onSelect([bounds[k], bounds[k + 1]])}>{text}</button></td>;
      })}</tr>)}</tbody>
    </table></div>
  </div>;
}

export function Splits({ runners, stations, total, source, meId, versus, selection, onSelect }: { runners: ProjectedRunner[]; stations: Station[]; total: number; source: LiveTrailSource; meId?: string; versus: Versus; selection: Range | null; onSelect: (range: Range) => void }) {
  const columns = ordered(runners, meId), mine = columns.findIndex(r => r.id === meId), vsMe = versus === 'me' && mine >= 0;
  const boundaries = [{ name: 'Départ', distance: 0 }, ...stations.filter(s => s.distance < total).sort((a, b) => a.distance - b.distance), { name: 'Arrivée', distance: total }];
  const rows = boundaries.slice(1).map((end, i) => {
    const start = boundaries[i];
    const values = columns.map(r => { const t = passageAt(r, end.distance, source) - passageAt(r, start.distance, source); return t >= 0 ? t : NaN; });
    const reference = vsMe ? values[mine] : Math.min(...values.filter(Number.isFinite));
    return { start, end, values, diffs: values.map(v => v - reference) };
  });
  const max = Math.max(1, ...rows.flatMap(r => r.diffs).filter(Number.isFinite).map(Math.abs));
  return <div className="analysis-table">
    <div className="analysis-caption"><span>Entre les contrôles · cliquer un tronçon pour l’analyser</span><HeatLegend max={max} versus={vsMe} /></div>
    <div className="table-scroll"><table className="rp-table heat-table"><thead><tr><th>Tronçon</th><th className="num">km</th>{columns.map(r => <th key={r.id} className={r.id === meId ? 'is-me' : ''}><i className="runner-dot" style={{ background: r.color }} />{r.name}</th>)}</tr></thead><tbody>{rows.map(({ start, end, values, diffs }, i) => {
      const active = selection?.[0] === start.distance && selection[1] === end.distance;
      return <tr key={`${end.name}-${i}`} className={active ? 'is-active' : ''}><th scope="row"><button className="split-select" onClick={() => onSelect([start.distance, end.distance])}>{start.name} → {end.name}</button></th><td className="num muted">{km(end.distance - start.distance)}</td>{columns.map((r, j) => {
        const me = vsMe && j === mine;
        return <td key={r.id} className="heat-cell" style={me ? undefined : vsMe ? heatDelta(diffs[j], max) : heat(diffs[j], max)}><b>{duration(values[j], true)}</b><small>{!Number.isFinite(values[j]) ? 'non pointé' : me ? 'moi' : vsMe ? shortGap(diffs[j], true) : diffs[j] <= .5 ? 'meilleur' : shortGap(diffs[j])}</small></td>;
      })}</tr>;
    })}</tbody></table></div>
  </div>;
}
