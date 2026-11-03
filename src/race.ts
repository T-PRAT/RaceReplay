import { uid, type LiveTrailSource, type RoutePoint, type Runner, type Station } from './model';

type Position = { lat: number; lon: number };
export function haversine(a: Position, b: Position) {
  const r = Math.PI / 180, dlat = (b.lat - a.lat) * r, dlon = (b.lon - a.lon) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function makeRoute(runner: Runner): RoutePoint[] {
  const route: RoutePoint[] = [];
  for (const p of runner.points) if (!route.length || p.distance - route.at(-1)!.distance >= 20) route.push({ lat: p.lat, lon: p.lon, alt: p.alt, distance: p.distance });
  const last = runner.points.at(-1)!;
  if (last.distance > route.at(-1)!.distance) route.push(last);
  return route;
}

// Prefer a start shared by the activities over a recording that begins down-course.
// This recommendation never overrides an explicitly selected reference.
export function suggestReferenceId(runners: Runner[]) {
  return runners.reduce((best, candidate) => {
    const score = (r: Runner) => runners.reduce((sum, other) => sum + haversine(r.points[0], other.points[0]), 0);
    return score(candidate) < score(best) ? candidate : best;
  }).id;
}

export function replayOrigin(runners: Runner[]) {
  // A display origin, not a claimed official gun time. Crucially, it is ONE
  // shared epoch: changing it cannot change relative positions or passage gaps.
  const starts = runners.map(r => r.points[0].time + r.offset).sort((a, b) => a - b);
  return starts[Math.floor(starts.length / 2)];
}

export type ProjectedRunner = Runner & { progress: number[]; offCourse: number };
export function projectRunner(runner: Runner, route: RoutePoint[]): ProjectedRunner {
  const latScale = 111320, lonScale = latScale * Math.cos(route[0].lat * Math.PI / 180);
  const xy = (p: Position) => ({ x: (p.lon - route[0].lon) * lonScale, y: (p.lat - route[0].lat) * latScale });
  const positions = route.map(xy), buckets = new Map<string, number[]>(), cell = 150;
  positions.forEach((p, i) => { const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`; const list = buckets.get(key) ?? []; list.push(i); buckets.set(key, list); });
  let progress = 0, offCourse = 0;
  const result = runner.points.map((p, j) => {
    const pos = xy(p), cx = Math.floor(pos.x / cell), cy = Math.floor(pos.y / cell);
    const dt = j ? p.time - runner.points[j - 1].time : 0;
    const maxForward = j ? Math.max(300, dt * 15) : 2000;
    let best = Infinity, next = progress;
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) for (const index of buckets.get(`${x},${y}`) ?? []) {
      const i = Math.min(index, route.length - 2), a = positions[i], b = positions[i + 1];
      if (route[i + 1].distance < progress - 100 || route[i].distance > progress + maxForward) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const dist = Math.hypot(pos.x - a.x - t * dx, pos.y - a.y - t * dy);
      const along = route[i].distance + t * (route[i + 1].distance - route[i].distance);
      const score = dist + Math.abs(along - progress) * .015;
      if (score < best) { best = score; next = along; }
    }
    if (best > 150) offCourse++;
    progress = Math.max(progress, next);
    return progress;
  });
  return { ...runner, progress: result, offCourse: offCourse / runner.points.length };
}

export function lowerBound(values: number[], value: number) {
  let lo = 0, hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
}
export function timeAt(r: ProjectedRunner, distance: number) {
  if (distance < r.progress[0] - 1e-6 || distance > r.progress.at(-1)! + 1e-6) return NaN;
  if (Math.abs(distance - r.progress[0]) <= 1e-6) {
    // At the starting point use departure, not the moment the watch was
    // switched on while standing there. Interior stops still use arrival.
    let lo = 0, hi = r.progress.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (r.progress[mid] <= r.progress[0] + 1e-6) lo = mid + 1; else hi = mid; }
    return r.points[Math.max(0, lo - 1)].time;
  }
  const i = lowerBound(r.progress, distance);
  if (i === 0) return r.points[0].time;
  if (i >= r.points.length) return NaN;
  const t = (distance - r.progress[i - 1]) / (r.progress[i] - r.progress[i - 1] || 1);
  return r.points[i - 1].time + t * (r.points[i].time - r.points[i - 1].time);
}
// One official timeline. Only a constant, verified clock offset is applied.
export const startTime = (r: Runner, origin: number) => r.points[0].time + r.offset - origin;
export function stateAt(r: ProjectedRunner, elapsed: number, origin: number) {
  const local = elapsed - startTime(r, origin);
  const time = Math.min(r.points[0].time + local, r.official?.finish !== undefined ? r.official.finish - r.offset : Infinity);
  let lo = 0, hi = r.points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (r.points[mid].time < time) lo = mid + 1; else hi = mid; }
  const i = lo, prev = Math.max(0, i - 1), a = r.points[prev], b = r.points[i];
  const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time || 1)));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  let back = i;
  while (back > 0 && b.time - r.points[back].time < 30) back--;
  const dt = b.time - r.points[back].time;
  const speed = dt > 0 ? (r.progress[i] - r.progress[back]) / dt : 0;
  return { runner: r, time, lat: lerp(a.lat, b.lat), lon: lerp(a.lon, b.lon), distance: lerp(r.progress[prev], r.progress[i]), alt: lerp(a.alt, b.alt), hr: b.hr, cadence: b.cadence, pace: speed > .3 ? 1000 / speed : NaN, local, pending: local < 0, recordingEnded: time >= r.points.at(-1)!.time, finished: r.official ? r.official.finish !== undefined && origin + elapsed >= r.official.finish : time >= r.points.at(-1)!.time };
}
export function elevationGain(route: RoutePoint[]) {
  let gain = 0, anchor = route[0]?.alt ?? 0;
  for (const p of route) if (Math.abs(p.alt - anchor) >= 5) { if (p.alt > anchor) gain += p.alt - anchor; anchor = p.alt; }
  return Math.round(gain);
}

export type Stop = { distance: number; duration: number; runnerId: string };
// Stationary episodes: under 0.5 m/s along the course over the last 10 s, for at
// least 10 s. A watch auto-pause (a gap without points) counts as stopped. Matches
// the LiveTrail in/out mats within seconds where both exist. Start and finish
// areas (300 m) are ignored.
export function detectStops(r: ProjectedRunner): Stop[] {
  const stops: Stop[] = [], last = r.progress.at(-1)!;
  let j = 0, current: Stop | null = null;
  for (let i = 1; i < r.points.length; i++) {
    while (j + 1 < i && r.points[i].time - r.points[j + 1].time >= 10) j++;
    const dt = r.points[i].time - r.points[j].time;
    const still = dt >= 10 && (r.progress[i] - r.progress[j]) / dt < .5;
    if (still) {
      current ??= { distance: r.progress[i], duration: 0, runnerId: r.id };
      current.duration += r.points[i].time - r.points[i - 1].time;
    }
    if (current && (!still || i === r.points.length - 1)) {
      if (current.duration >= 10 && current.distance > 300 && current.distance < last - 300) stops.push(current);
      current = null;
    }
  }
  return stops;
}
export function detectStations(runners: ProjectedRunner[]): Station[] {
  const clusters: Stop[][] = [];
  for (const stop of runners.flatMap(detectStops).sort((a, b) => a.distance - b.distance)) {
    const last = clusters.at(-1);
    if (last && Math.abs(last.reduce((s, p) => s + p.distance, 0) / last.length - stop.distance) < 200) last.push(stop);
    else clusters.push([stop]);
  }
  return clusters.filter(c => new Set(c.map(s => s.runnerId)).size >= 2).map((c, i) => ({ id: uid(), name: `Ravito ${i + 1}`, distance: Math.round(c.reduce((sum, s) => sum + s.distance, 0) / c.length), automatic: true, support: new Set(c.map(s => s.runnerId)).size }));
}
export function routePosition(route: RoutePoint[], distance: number) {
  let lo = 0, hi = route.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (route[mid].distance < distance) lo = mid + 1; else hi = mid; }
  return route[lo];
}
function routeAltitude(route: RoutePoint[], distance: number) {
  const d = Math.max(0, Math.min(route.at(-1)!.distance, distance));
  let lo = 0, hi = route.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (route[mid].distance < d) lo = mid + 1; else hi = mid; }
  if (lo === 0) return route[0].alt;
  const a = route[lo - 1], b = route[lo], t = (d - a.distance) / (b.distance - a.distance || 1);
  return a.alt + t * (b.alt - a.alt);
}
export function climb(route: RoutePoint[], from: number, to: number) {
  let up = 0, down = 0, anchor = routeAltitude(route, from);
  for (const p of [...route.filter(p => p.distance > from && p.distance < to), { alt: routeAltitude(route, to) }]) {
    if (Math.abs(p.alt - anchor) < 5) continue;
    if (p.alt > anchor) up += p.alt - anchor; else down += anchor - p.alt;
    anchor = p.alt;
  }
  return { up: Math.round(up), down: Math.round(down) };
}

// Strava's speed factor by grade, measured by A. Schroeder (specialsauce):
// independent of speed, capped at ±45 %.
const GRADE_FACTORS = [[-45, 2.096], [-30, 1.495], [-25, 1.273], [-20, 1.081], [-15, .941], [-10, .876], [-8, .876], [-6, .891], [-4, .918], [-2, .96], [0, 1], [2, 1.055], [4, 1.135], [6, 1.228], [8, 1.337], [10, 1.459], [15, 1.846], [20, 2.297], [25, 2.727], [30, 3.158], [45, 4.286]];
export function gradeFactor(grade: number) {
  const g = Math.max(-45, Math.min(45, grade * 100)), i = Math.max(1, GRADE_FACTORS.findIndex(([x]) => x >= g));
  const [x0, y0] = GRADE_FACTORS[i - 1], [x1, y1] = GRADE_FACTORS[i];
  return y0 + (y1 - y0) * (g - x0) / (x1 - x0);
}
// Grade of each route segment, from the official profile over 100 m, so every
// runner gets the same one.
function segmentGrades(route: RoutePoint[]) {
  const total = route.at(-1)!.distance;
  return route.slice(1).map((p, i) => {
    const mid = (route[i].distance + p.distance) / 2, from = Math.max(0, mid - 50), to = Math.min(total, mid + 50);
    return (routeAltitude(route, to) - routeAltitude(route, from)) / (to - from || 1);
  });
}
// Grade-adjusted ("flat equivalent") distance at each route distance.
export function gradeAdjuster(route: RoutePoint[]) {
  const total = route.at(-1)!.distance, distances = route.map(p => p.distance), flat = [0];
  segmentGrades(route).forEach((grade, i) => flat.push(flat[i] + (route[i + 1].distance - route[i].distance) * gradeFactor(grade)));
  return (distance: number) => {
    const d = Math.max(0, Math.min(total, distance)), i = Math.max(1, Math.min(route.length - 1, lowerBound(distances, d)));
    const t = (d - route[i - 1].distance) / (route[i].distance - route[i - 1].distance || 1);
    return flat[i - 1] + t * (flat[i] - flat[i - 1]);
  };
}
export type GradeAdjuster = ReturnType<typeof gradeAdjuster>;

function timeIndex(r: Runner, time: number) {
  let lo = 0, hi = r.points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (r.points[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo;
}
export function progressAt(r: ProjectedRunner, time: number) {
  const i = timeIndex(r, time);
  if (i === 0) return r.progress[0];
  const a = r.points[i - 1], b = r.points[i], t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time || 1)));
  return r.progress[i - 1] + t * (r.progress[i] - r.progress[i - 1]);
}
// Pace and grade-adjusted pace over the last `window` seconds of watch time, stops included.
export function recentPace(r: ProjectedRunner, time: number, adjust: GradeAdjuster, window = 180) {
  const from = Math.max(r.points[0].time, time - window), dt = time - from;
  if (dt < 30) return { pace: NaN, adjusted: NaN };
  const d0 = progressAt(r, from), d1 = progressAt(r, time);
  const speed = (d1 - d0) / dt, flat = (adjust(d1) - adjust(d0)) / dt;
  return { pace: speed > .3 ? 1000 / speed : NaN, adjusted: flat > .3 ? 1000 / flat : NaN };
}
// Time-weighted mean of a watch channel; zeros (sensor off, standing still) are ignored.
export function channelMean(r: Runner, key: 'hr' | 'cadence', from = -Infinity, to = Infinity) {
  let sum = 0, weight = 0;
  for (let i = Math.max(0, timeIndex(r, from) - 1); i < r.points.length - 1 && r.points[i].time < to; i++) {
    const value = r.points[i][key], dt = Math.min(r.points[i + 1].time, to) - Math.max(r.points[i].time, from);
    if (!value || dt <= 0) continue;
    const w = Math.min(dt, 10); sum += value * w; weight += w;
  }
  return weight ? sum / weight : NaN;
}
// FIT running cadence counts one foot; show steps per minute like the watch apps.
export function cadenceScale(r: Runner) {
  const values = r.points.map(p => p.cadence ?? 0).filter(v => v > 0).sort((a, b) => a - b);
  return values.length && values[values.length >>> 1] < 120 ? 2 : 1;
}

// Gap of `other` to `me` at replay clock `clock`, compared at the same point of the
// course: positive when `other` is behind me, negative when ahead.
type Placed = { runner: ProjectedRunner; distance: number; pending: boolean; finished: boolean };
export function liveGap(other: Placed, me: Placed, clock: number) {
  if (other.pending || me.pending) return NaN;
  const a = other.runner.official?.finish, b = me.runner.official?.finish;
  if (other.finished && me.finished && a !== undefined && b !== undefined) return a - b;
  const now = (s: Placed) => Math.min(s.runner.points.at(-1)!.time + s.runner.offset, clock, s.runner.official?.finish ?? Infinity);
  const passed = (s: Placed, d: number) => s.finished && d >= s.distance - 1 && s.runner.official?.finish !== undefined ? s.runner.official.finish : timeAt(s.runner, d) + s.runner.offset;
  return other.distance <= me.distance ? now(other) - passed(me, other.distance) : passed(other, me.distance) - now(me);
}

// Officially timed boundaries use LiveTrail; anywhere else uses the corrected GPS clock.
export function passageAt(r: ProjectedRunner, distance: number, source: LiveTrailSource) {
  const total = source.route.at(-1)!.distance, gps = timeAt(r, distance) + r.offset;
  if (distance <= 1) return r.official?.start ?? gps;
  if (distance >= total - 1) return r.official?.finish ?? gps;
  const point = source.points.find(p => Math.abs(p.distance - distance) < 1);
  return (point && r.official?.passings.find(p => p.pointId === point.id)?.time) ?? gps;
}
export function zoneStats(r: ProjectedRunner, from: number, to: number, source: LiveTrailSource, adjust: GradeAdjuster, stops: Stop[]) {
  const start = passageAt(r, from, source), end = passageAt(r, to, source), time = end - start;
  const covered = Number.isFinite(time) && time > 0;
  const hr = covered ? channelMean(r, 'hr', start - r.offset, end - r.offset) : NaN;
  const cadence = covered ? channelMean(r, 'cadence', start - r.offset, end - r.offset) * cadenceScale(r) : NaN;
  return {
    runner: r, start, end, time: covered ? time : NaN, hr, cadence,
    pace: covered ? time / (to - from) * 1000 : NaN,
    adjusted: covered ? time / (adjust(to) - adjust(from)) * 1000 : NaN,
    stopped: stops.filter(s => s.runnerId === r.id && s.distance >= from && s.distance <= to).reduce((sum, s) => sum + s.duration, 0),
  };
}

// Time stopped at each official aid station: GPS stationary time within 200 m,
// plus the LiveTrail in → out mats when both were read (often only one is).
export function aidStops(r: ProjectedRunner, source: LiveTrailSource, stops: Stop[]) {
  const mine = stops.filter(s => s.runnerId === r.id);
  return source.points.filter(p => p.aid).map(point => {
    const passing = r.official?.passings.find(p => p.pointId === point.id);
    const mats = passing?.outTime !== undefined && passing.outTime - passing.time >= 1 ? passing.outTime - passing.time : undefined;
    return { point, stopped: mine.filter(s => Math.abs(s.distance - point.distance) <= 200).reduce((sum, s) => sum + s.duration, 0), mats, reached: passing !== undefined };
  });
}

// Whole-race figures, between the official start and finish.
export function raceSummary(r: ProjectedRunner, source: LiveTrailSource, adjust: GradeAdjuster, stops: Stop[]) {
  const route = source.route, total = route.at(-1)!.distance, grades = segmentGrades(route), distances = route.map(p => p.distance);
  const race = zoneStats(r, 0, total, source, adjust, stops);
  const halves = [zoneStats(r, 0, total / 2, source, adjust, stops), zoneStats(r, total / 2, total, source, adjust, stops)];
  const mine = stops.filter(s => s.runnerId === r.id), stopped = mine.reduce((sum, s) => sum + s.duration, 0);
  const aid = aidStops(r, source, stops).reduce((sum, a) => sum + a.stopped, 0);
  // Moving time by terrain: climbs and descents steeper than 5 %, the rest is flat.
  const terrain = { climb: { time: 0, distance: 0, vertical: 0 }, descent: { time: 0, distance: 0, vertical: 0 }, flat: { time: 0, distance: 0, vertical: 0 } };
  const from = (r.official?.start ?? -Infinity) - r.offset, to = (r.official?.finish ?? Infinity) - r.offset;
  let hrMax = NaN, window: number[] = [];
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i];
    if (b.time <= from || a.time >= to) continue;
    // Highest heart rate held over 15 points, so a single sensor spike does not count.
    if (b.hr) { window.push(b.hr); if (window.length > 15) window.shift(); if (window.length === 15) hrMax = Math.max(Number.isFinite(hrMax) ? hrMax : 0, window.reduce((x, y) => x + y) / 15); }
    const dt = b.time - a.time, dd = r.progress[i] - r.progress[i - 1];
    if (dt <= 0 || dt > 30 || dd / dt < .3) continue;
    const mid = (r.progress[i] + r.progress[i - 1]) / 2, grade = grades[Math.max(0, Math.min(grades.length - 1, lowerBound(distances, mid) - 1))];
    const kind = grade > .05 ? terrain.climb : grade < -.05 ? terrain.descent : terrain.flat;
    kind.time += dt; kind.distance += dd; kind.vertical += Math.abs(routeAltitude(route, r.progress[i]) - routeAltitude(route, r.progress[i - 1]));
  }
  return { race, halves, stopped, stopCount: mine.length, aid, moving: race.time - stopped, terrain, hrMax };
}
export type RaceSummary = ReturnType<typeof raceSummary>;
