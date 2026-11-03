import type { LiveTrailRace, LiveTrailSource, OfficialRunner, RoutePoint } from './model';

export function parseLiveTrailUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Colle un lien LiveTrail complet, commençant par https://.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.v3\.livetrail\.net$/.test(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Utilise un lien public LiveTrail v3 (https://evenement.v3.livetrail.net/…).');
  }
  const year = url.pathname.match(/(?:^|\/)(20\d{2})(?:\/|$)/)?.[1];
  const raceId = url.searchParams.get('raceId') ?? url.pathname.match(/\/races\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!year || !raceId || !/^[\w-]{1,40}$/.test(raceId)) throw new Error('Le lien doit préciser l’édition et la course (paramètre raceId). Copie le lien du tableau des passages.');
  return { tenant: `${url.hostname.split('.')[0]}_${year}`, raceId, url: `${url.origin}/fr/${year}/passings-table?raceId=${encodeURIComponent(raceId)}` };
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Réponse LiveTrail inattendue.');
  return v as Record<string, unknown>;
};
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('Liste LiveTrail invalide.'); return v; };
const numeric = (v: unknown) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Valeur LiveTrail invalide.'); return v; };
const text = (v: unknown) => { if (typeof v !== 'string' || !v) throw new Error('Libellé LiveTrail invalide.'); return v; };
const timestamp = (v: unknown) => {
  if (typeof v !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) throw new Error('Horaire LiveTrail sans fuseau explicite.');
  return Date.parse(v) / 1000;
};

export function decodeTrack(value: unknown): RoutePoint[] {
  const points = list(object(value).segments).flatMap(segment => list(object(segment).segment).map(value => {
    const p = list(value), coords = list(p[2]);
    return { distance: numeric(p[0]), alt: numeric(p[1]), lon: numeric(coords[0]), lat: numeric(coords[1]) };
  }));
  if (points.length < 2 || points.length > 100000 || points[0].distance !== 0 || points.some((p, i) => Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || (i > 0 && p.distance < points[i - 1].distance))) throw new Error('Le parcours officiel est absent ou invalide.');
  return points.filter((p, i) => i === 0 || p.distance > points[i - 1].distance);
}

export function decodeEntrants(value: unknown, points: LiveTrailSource['points'], start: number): OfficialRunner[] {
  return list(object(value).rows).map(value => {
    const row = object(value), runner = object(row.runner), passings = object(row.passingsByPointId);
    const bib = String(runner.bib);
    if (!/^\d{1,10}$/.test(bib)) throw new Error('Dossard LiveTrail invalide.');
    const decoded = points.flatMap(point => {
      const p = passings[point.id];
      if (!p) return [];
      const data = object(p), arrival = data.datetimeIn ?? data.datetimeOut;
      if (!arrival) return [];
      const time = timestamp(arrival);
      const outTime = data.datetimeOut ? timestamp(data.datetimeOut) : undefined;
      return [{ pointId: point.id, time, ...(outTime !== undefined && outTime >= time ? { outTime } : {}) }];
    });
    const name = [runner.firstName, runner.lastName].filter(v => typeof v === 'string' && v.trim()).join(' ').trim() || `Dossard ${bib}`;
    const finish = decoded.find(p => p.pointId === points.at(-1)?.id)?.time;
    return { bib, name, start: decoded.find(p => p.pointId === points[0]?.id)?.time ?? start, ...(finish !== undefined ? { finish } : {}), passings: decoded };
  });
}

export async function loadLiveTrail(value: string, signal?: AbortSignal): Promise<LiveTrailRace> {
  const source = parseLiveTrailUrl(value);
  const get = async (path: string) => {
    const response = await fetch(`https://api.v3.livetrail.net/api${path}`, { headers: { 'X-Tenant': source.tenant }, signal: signal ?? AbortSignal.timeout(25000), credentials: 'omit' });
    if (!response.ok) throw new Error(`LiveTrail ne répond pas pour cette course (HTTP ${response.status}). Vérifie le lien ou réessaie.`);
    return response.json() as Promise<unknown>;
  };
  const id = encodeURIComponent(source.raceId);
  const [rawEvent, rawRace, rawPoints] = await Promise.all([get('/events/global-event?locale=fr'), get(`/events/races/${id}`), get(`/events/points?raceId=${id}`)]);
  const event = object(rawEvent), race = object(rawRace), start = timestamp(race.startDate), timeZone = text(event.timezone);
  try { new Intl.DateTimeFormat('fr-FR', { timeZone }); } catch { throw new Error('Fuseau horaire LiveTrail non reconnu.'); }
  const points = list(rawPoints).map(value => {
    const p = object(value);
    return { id: String(p.pointId), name: text(p.name), distance: numeric(p.distance), lat: numeric(p.lat), lon: numeric(p.lon), aid: list(p.services).some(s => typeof s === 'string' && s.startsWith('AID_STATION')) };
  }).filter(p => p.distance >= 0).sort((a, b) => a.distance - b.distance);
  if (points.length < 2 || points.length > 200 || points[0].distance !== 0 || points.some(p => Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) throw new Error('Les points de passage officiels ne sont pas exploitables.');
  const trackUrl = new URL(text(race.trackUrl));
  if (trackUrl.protocol !== 'https:' || trackUrl.hostname !== 'livetrailv3.s3.gra.io.cloud.ovh.net') throw new Error('Ce format de parcours LiveTrail n’est pas encore pris en charge.');
  const trackResponse = await fetch(trackUrl, { signal: signal ?? AbortSignal.timeout(25000), credentials: 'omit' });
  if (!trackResponse.ok) throw new Error('Le parcours officiel est temporairement indisponible.');
  const route = decodeTrack(await trackResponse.json());
  const entrants: OfficialRunner[] = [], seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const data = object(await get(`/events/passings/${id}?display=DATETIME&limit=1000&page=${page}`));
    const rows = decodeEntrants(data, points, start);
    if (rows.some(r => seen.has(r.bib))) throw new Error('Pagination LiveTrail incohérente : certains coureurs sont répétés.');
    rows.forEach(r => { seen.add(r.bib); entrants.push(r); });
    if (entrants.length >= numeric(data.total)) break;
    if (!rows.length || page === 99) throw new Error('La liste LiveTrail est incomplète. Réessaie plus tard.');
  }
  if (!entrants.length) throw new Error('Cette course ne contient pas encore de pointages.');
  return { url: source.url, raceId: source.raceId, eventName: text(event.name), raceName: text(race.fullName), timeZone, start, points, route, entrants };
}

// Overall finishing position by official race time, among all finishers of the race.
export function finishingRanks(entrants: OfficialRunner[]) {
  const finishers = entrants.filter(e => e.finish !== undefined).sort((x, y) => (x.finish! - x.start) - (y.finish! - y.start));
  return new Map(finishers.map((e, i) => [e.bib, i + 1]));
}

export function validateSavedSource(source: LiveTrailSource, runners: import('./model').Runner[]) {
  if (!source || typeof source !== 'object' || typeof source.url !== 'string') throw new Error('Source LiveTrail invalide.');
  const parsed = parseLiveTrailUrl(source.url);
  if (parsed.raceId !== source.raceId || !Number.isFinite(source.start) || typeof source.eventName !== 'string' || typeof source.raceName !== 'string' || typeof source.timeZone !== 'string') throw new Error('Course LiveTrail invalide.');
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: source.timeZone }); } catch { throw new Error('Fuseau horaire invalide dans le replay.'); }
  if (!Array.isArray(source.route) || source.route.length < 2 || source.route.length > 100000 || source.route[0].distance !== 0 || !source.route.every((p, i) => p && ['lat', 'lon', 'alt', 'distance'].every(k => Number.isFinite(p[k as keyof RoutePoint])) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (i === 0 || p.distance > source.route[i - 1].distance))) throw new Error('Parcours LiveTrail invalide dans le replay.');
  if (!Array.isArray(source.points) || source.points.length < 2 || source.points.length > 200 || !source.points.every((p, i) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.aid === 'boolean' && [p.distance, p.lat, p.lon].every(Number.isFinite) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.distance >= 0 && p.distance <= source.route.at(-1)!.distance + 200 && (i === 0 || p.distance > source.points[i - 1].distance))) throw new Error('Contrôles LiveTrail invalides dans le replay.');
  const ids = new Set(source.points.map(p => p.id)), bibs = new Set<string>();
  if (source.points[0].distance !== 0 || ids.size !== source.points.length) throw new Error('Contrôles LiveTrail dupliqués ou départ absent.');
  const position = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) > 0 && (n as number) <= 100000);
  if (!position(source.finishers)) throw new Error('Nombre de finishers invalide dans le replay.');
  for (const runner of runners) {
    const r = runner.official;
    if (!r || !/^\d{1,10}$/.test(r.bib) || bibs.has(r.bib) || typeof r.name !== 'string' || !position(r.rank) || !Number.isFinite(r.start) || (r.finish !== undefined && (!Number.isFinite(r.finish) || r.finish < r.start)) || !Array.isArray(r.passings) || r.passings.length > 200 || !r.passings.every(p => p && ids.has(p.pointId) && Number.isFinite(p.time) && (p.outTime === undefined || (Number.isFinite(p.outTime) && p.outTime >= p.time)))) throw new Error('Pointages coureur invalides dans le replay.');
    bibs.add(r.bib);
  }
}
