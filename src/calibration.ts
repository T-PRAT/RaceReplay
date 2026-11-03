import type { Calibration, LiveTrailSource, OfficialRunner, Project, Runner, Station } from './model';
import { uid } from './model';
import { lowerBound, makeRoute, projectRunner, timeAt } from './race';

const median = (ns: number[]) => { const s = [...ns].sort((a, b) => a - b); return s.length % 2 ? s[s.length >>> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export function calibrate(runner: Runner, official: OfficialRunner, race: LiveTrailSource): Calibration {
  const projected = projectRunner(runner, race.route);
  // Avoid the start (watch switched on early) and finish (watch stopped late).
  const interior = race.points.filter(p => p.distance > 200 && p.distance < race.route.at(-1)!.distance - 200);
  const anchors = interior.flatMap(point => {
    const passing = official.passings.find(p => p.pointId === point.id);
    const gpsTime = timeAt(projected, point.distance);
    if (!passing || !Number.isFinite(gpsTime)) return [];
    return [{ pointId: point.id, name: point.name, officialTime: passing.time, gpsTime, residual: 0 }];
  });
  if (anchors.length < 2 || projected.offCourse > .1) return { offset: runner.offset, reliable: false, spread: 0, anchors, warning: anchors.length < 2 ? 'Au moins deux contrôles intermédiaires sont nécessaires pour vérifier l’horloge.' : 'La trace s’écarte trop du parcours officiel. Vérifie le coureur et le fichier associés.' };
  const deltas = anchors.map(a => a.officialTime - a.gpsTime), estimated = median(deltas);
  // Correct demonstrable clock/timezone errors, not GPS noise at the timing mat.
  // Prefer an exact quarter-hour shift when it explains the observations to 45 s.
  const clockShift = Math.round(estimated / 900) * 900;
  const offset = Math.abs(estimated - clockShift) <= 45 ? clockShift : Math.round(estimated);
  const residuals = deltas.map(d => d - offset), spread = Math.round(median(residuals.map(Math.abs)));
  const reliable = spread <= 45 && residuals.every(v => Math.abs(v) <= 120) && residuals.filter(v => Math.abs(v) <= 90).length >= Math.ceil(anchors.length * .75);
  return { offset, reliable, spread, anchors: anchors.map((a, i) => ({ ...a, residual: Math.round(residuals[i]) })), ...(!reliable ? { warning: 'Les contrôles ne concordent pas avec une correction constante. Vérifie l’association FIT–dossard ; aucun étirement du temps n’est appliqué.' } : {}) };
}

export function officialStations(race: LiveTrailSource): Station[] {
  return race.points.slice(1, -1).map(p => ({ id: `livetrail-${p.id}`, name: p.name, distance: p.distance, automatic: false, support: 0, official: true }));
}

export function transferManualStations(project: Project, source: LiveTrailSource): Station[] {
  const manual = project.stations.filter(s => !s.automatic && !s.official);
  if (!manual.length) return [];
  const reference = project.runners.find(r => r.id === project.referenceId)!;
  const previous = projectRunner(reference, project.liveTrail?.route ?? makeRoute(reference));
  const next = projectRunner(reference, source.route);
  return manual.map(station => {
    const i = Math.min(lowerBound(previous.progress, station.distance), previous.progress.length - 1), before = Math.max(0, i - 1);
    const t = Math.max(0, Math.min(1, (station.distance - previous.progress[before]) / (previous.progress[i] - previous.progress[before] || 1)));
    const distance = next.progress[before] + (next.progress[i] - next.progress[before]) * t;
    return { ...station, id: station.id.startsWith('livetrail-') ? uid() : station.id, distance, official: false };
  }).filter(s => s.distance > 0 && s.distance < source.route.at(-1)!.distance);
}

export function calibrationIssues(runner: Runner, race: LiveTrailSource) {
  if (!runner.official) return ['Associe ce fichier à un participant LiveTrail.'];
  const result = calibrate(runner, runner.official, race);
  if (!result.reliable) return [result.warning!];
  const inconsistent = result.anchors.some(a => Math.abs(a.officialTime - a.gpsTime - runner.offset) > 120);
  return inconsistent ? ['La correction sélectionnée ne concorde pas avec les pointages officiels.'] : [];
}
