export type Point = {
  lat: number; lon: number; alt: number; time: number;
  hr?: number; cadence?: number; distance: number;
};
export type Runner = {
  id: string; name: string; fileName: string; color: string;
  offset: number; points: Point[]; warnings: string[];
  official?: OfficialRunner;
  calibration?: Calibration;
};
export type RoutePoint = { lat: number; lon: number; alt: number; distance: number };
export type Station = { id: string; name: string; distance: number; automatic: boolean; support: number; official?: boolean };
export type OfficialPassing = { pointId: string; time: number; outTime?: number };
// rank: overall finishing position, computed from all LiveTrail finishers.
export type OfficialRunner = { bib: string; name: string; start: number; finish?: number; rank?: number; passings: OfficialPassing[] };
export type OfficialPoint = { id: string; name: string; distance: number; lat: number; lon: number; aid: boolean };
export type LiveTrailSource = {
  url: string; raceId: string; eventName: string; raceName: string; timeZone: string;
  start: number; points: OfficialPoint[]; route: RoutePoint[]; finishers?: number;
};
export type LiveTrailRace = LiveTrailSource & { entrants: OfficialRunner[] };
export type Calibration = {
  offset: number; reliable: boolean; spread: number;
  anchors: { pointId: string; name: string; officialTime: number; gpsTime: number; residual: number }[];
  warning?: string;
};
// meId: the runner the replay is analysed for. Optional, a friend may be a spectator.
export type Project = { version: 1; title: string; runners: Runner[]; stations: Station[]; referenceId: string; meId?: string; liveTrail?: LiveTrailSource };
export const COLORS = ['#e47748', '#487fbe', '#8b70b2', '#379d85', '#c49c30', '#d36596', '#657a42', '#986b4e', '#528e9e', '#9b5664'];
export const uid = () => crypto.randomUUID();
export const localTime = (time: number, timeZone = 'Europe/Paris') => new Date(time * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone });
export function duration(seconds: number, detailed = false) {
  if (!Number.isFinite(seconds)) return '—';
  const n = Math.max(0, Math.round(seconds));
  const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60;
  return detailed ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s).padStart(2, '0')}`;
}
// m:ss under an hour, h:mm:ss above.
export function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return '—';
  const n = Math.max(0, Math.round(seconds)), h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
export const km = (m: number) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
export function gap(seconds: number) {
  if (!Number.isFinite(seconds)) return '—';
  return `${seconds < 0 ? '−' : '+'}${duration(Math.abs(seconds), true)}`;
}
