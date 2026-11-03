import { COLORS, uid, type Point, type Project, type Runner } from './model';
import { haversine } from './race';
import { validateSavedSource } from './livetrail';
import { calibrate } from './calibration';

const number = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export async function importActivity(file: File, index: number): Promise<Runner> {
  if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} : limite de 50 Mo par activité.`);
  const ext = file.name.split('.').pop()?.toLowerCase();
  let raw: Omit<Point, 'distance'>[] = [];
  if (ext === 'fit') {
    const { default: FitParser } = await import('fit-file-parser');
    const data = await new FitParser({ force: false, mode: 'list', lengthUnit: 'm', speedUnit: 'm/s' }).parseAsync(await file.arrayBuffer());
    raw = (data.records ?? []).map(r => ({
      lat: Number(r.position_lat), lon: Number(r.position_long),
      alt: number(r.enhanced_altitude) ?? number(r.altitude) ?? 0,
      time: new Date(r.timestamp as Date).getTime() / 1000,
      hr: number(r.heart_rate), cadence: number(r.cadence),
    }));
  } else if (ext === 'gpx' || ext === 'tcx') {
    const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`${file.name} : XML invalide.`);
    const elements = (parent: Element | Document, tag: string) => Array.from(parent.getElementsByTagNameNS('*', tag));
    const text = (parent: Element, tag: string) => elements(parent, tag)[0]?.textContent ?? '';
    const numeric = (parent: Element, tag: string) => text(parent, tag) === '' ? undefined : number(Number(text(parent, tag)));
    raw = elements(doc, ext === 'gpx' ? 'trkpt' : 'Trackpoint').map(p => ({
      lat: ext === 'gpx' ? p.hasAttribute('lat') ? Number(p.getAttribute('lat')) : NaN : numeric(p, 'LatitudeDegrees') ?? NaN,
      lon: ext === 'gpx' ? p.hasAttribute('lon') ? Number(p.getAttribute('lon')) : NaN : numeric(p, 'LongitudeDegrees') ?? NaN,
      alt: numeric(p, ext === 'gpx' ? 'ele' : 'AltitudeMeters') ?? 0,
      time: Date.parse(text(p, ext === 'gpx' ? 'time' : 'Time')) / 1000,
      hr: ext === 'gpx' ? numeric(p, 'hr') : numeric(elements(p, 'HeartRateBpm')[0] ?? p, 'Value'),
      cadence: numeric(p, ext === 'gpx' ? 'cad' : 'Cadence'),
    }));
  } else throw new Error(`${file.name} : utilise un fichier FIT, GPX ou TCX.`);
  const valid = raw.filter(p => Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && Number.isFinite(p.time));
  if (valid.length < 2) throw new Error(`${file.name} : pas assez de points GPS horodatés. Un GPX de parcours seul ne permet pas un replay.`);
  valid.sort((a, b) => a.time - b.time);
  const points: Point[] = [];
  let distance = 0;
  for (const p of valid) {
    const prev = points.at(-1);
    if (prev && p.time <= prev.time) continue;
    if (prev) {
      const step = haversine(prev, p);
      if (step / (p.time - prev.time) > 25) continue;
      distance += step;
    }
    points.push({ ...p, distance });
  }
  if (points.length < 2 || distance < 100) throw new Error(`${file.name} : trace trop courte ou GPS invalide.`);
  const warnings: string[] = [];
  if (valid.length < raw.length * .95) warnings.push('Certains points sans GPS ou sans horaire ont été ignorés.');
  if (points.some((p, i) => i > 0 && p.time - points[i - 1].time > 60)) warnings.push('Coupures GPS de plus d’une minute : les positions seront interpolées.');
  return { id: uid(), fileName: file.name, name: `Coureur ${index + 1}`, color: COLORS[index % COLORS.length], offset: 0, points, warnings };
}

export async function readProject(file: File): Promise<Project> {
  if (file.size > 100 * 1024 * 1024) throw new Error('Ce replay dépasse la limite de 100 Mo.');
  const p = JSON.parse(await file.text()) as Project;
  if (!p || p.version !== 1 || typeof p.title !== 'string' || !Array.isArray(p.runners) || p.runners.length < 2 || p.runners.length > 10 || !Array.isArray(p.stations)) throw new Error('Fichier RaceReplay invalide ou version non prise en charge.');
  const ids = new Set<string>();
  for (const r of p.runners) {
    if (typeof r.id !== 'string' || ids.has(r.id) || typeof r.name !== 'string' || typeof r.fileName !== 'string' || !/^#[0-9a-f]{6}$/i.test(r.color) || !Number.isFinite(r.offset) || Math.abs(r.offset) > 86400 || !Array.isArray(r.points) || r.points.length < 2 || !Array.isArray(r.warnings) || !r.warnings.every(w => typeof w === 'string')) throw new Error('Données coureur invalides.');
    ids.add(r.id);
    if (!r.points.every((pt, i) => ['lat', 'lon', 'alt', 'time', 'distance'].every(k => Number.isFinite(pt[k as keyof Point])) && Math.abs(pt.lat) <= 90 && Math.abs(pt.lon) <= 180 && (i === 0 || (pt.time > r.points[i - 1].time && pt.distance >= r.points[i - 1].distance)) && (pt.hr === undefined || Number.isFinite(pt.hr)) && (pt.cadence === undefined || Number.isFinite(pt.cadence)))) throw new Error('Points GPS invalides dans le replay.');
  }
  if (!ids.has(p.referenceId) || (p.meId !== undefined && !ids.has(p.meId)) || p.stations.length > 200 || !p.stations.every(s => typeof s.id === 'string' && typeof s.name === 'string' && Number.isFinite(s.distance) && s.distance > 0 && typeof s.automatic === 'boolean' && Number.isFinite(s.support))) throw new Error('Parcours ou ravitos invalides.');
  p.runners.forEach(r => { delete r.calibration; });
  if (p.liveTrail !== undefined) {
    validateSavedSource(p.liveTrail, p.runners);
    const source = p.liveTrail;
    p.runners.forEach(r => { r.calibration = calibrate(r, r.official!, source); });
  }
  return p;
}

export function saveProject(project: Project) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${project.title.replace(/[^\p{L}\p{N} -]/gu, '').trim() || 'course'}.racereplay`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
