import type { CSSProperties } from 'react';
import { duration } from './model';

// Colours come from the theme (--heat-*), mixed by intensity t in [0, 1].
// The square root keeps small differences visible next to a big one.
const mix = (color: string, t: number) => `color-mix(in oklab, var(${color}) ${Math.round(t * 100)}%, var(--heat-min))`;
const ink = (t: number) => t > .62 ? 'var(--heat-ink-strong)' : 'var(--heat-ink)';
const intensity = (seconds: number, max: number) => Math.sqrt(Math.min(1, Math.abs(seconds) / Math.max(1, max)));

// Time lost against the best in view: the fastest is green, the biggest loss full red.
export function heat(loss: number, max: number): CSSProperties | undefined {
  if (!Number.isFinite(loss)) return undefined;
  if (loss <= .5) return { background: 'var(--heat-best)', color: 'var(--heat-best-ink)' };
  const t = intensity(loss, max);
  return { background: mix('--heat-bad', t), color: ink(t) };
}
// Another runner against me (their time − mine): red where they were faster, green where slower.
export function heatDelta(delta: number, max: number): CSSProperties | undefined {
  if (!Number.isFinite(delta)) return undefined;
  const t = intensity(delta, max);
  return { background: mix(delta < 0 ? '--heat-bad' : '--heat-good', t), color: ink(t) };
}

export function shortGap(seconds: number, signed = false) {
  if (!Number.isFinite(seconds)) return '—';
  const n = Math.round(Math.abs(seconds)), sign = signed && seconds < 0 && n ? '−' : '+';
  if (n < 60) return `${sign}${n} s`;
  const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = String(n % 60).padStart(2, '0');
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${s}` : `${sign}${m}:${s}`;
}

// Without `max`, the legend only names both ends (tables mixing units).
export function HeatLegend({ max, versus, labels }: { max?: number; versus?: boolean; labels?: [string, string] }) {
  if (versus) return <div className="heat-legend"><span>{labels?.[0] ?? 'plus rapide'}</span><i className="heat-legend-delta" /><span>{labels?.[1] ?? 'plus lent que moi'}</span></div>;
  if (max === undefined) return <div className="heat-legend"><span>{labels?.[0]}</span><i className="heat-legend-best" /><span>{labels?.[1]}</span></div>;
  return <div className="heat-legend" aria-label={`Temps perdu : de 0 à ${duration(max, true)}`}><span>perdu</span><b style={heat(0, max)}>0</b><i /><span>{shortGap(max)}</span></div>;
}
