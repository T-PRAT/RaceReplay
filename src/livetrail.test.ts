import { afterEach, describe, expect, it, vi } from 'vitest';
import { calibrate, calibrationIssues, officialStations, transferManualStations } from './calibration';
import { decodeEntrants, decodeTrack, loadLiveTrail, parseLiveTrailUrl, validateSavedSource } from './livetrail';
import { readProject } from './import';
import { makeRoute, projectRunner, stateAt } from './race';
import type { LiveTrailSource, OfficialRunner, Project, Runner } from './model';

const url = 'https://example.v3.livetrail.net/fr/2026/passings-table?raceId=TR&page=0&limit=10';
function fixture() {
  const runner: Runner = { id: 'gps', name: 'Test', fileName: 'test.fit', color: '#e47748', offset: 0, warnings: [], points: Array.from({ length: 201 }, (_, i) => ({ time: 8200 + i * 5, distance: i * 10, lat: 43 + i * 10 / 111195, lon: 2, alt: 100 })) };
  const route = makeRoute(runner);
  const points = [0, 400, 800, 1200, 2000].map((distance, i) => ({ id: String(i), name: `Point ${i}`, distance, lat: 43 + distance / 111195, lon: 2, aid: i > 0 && i < 4 }));
  const source: LiveTrailSource = { url, raceId: 'TR', eventName: 'Test', raceName: 'Trail', timeZone: 'Europe/Paris', start: 1000, route, points };
  const official: OfficialRunner = { bib: '42', name: 'Test RUNNER', start: 1000, finish: 2000, passings: points.map(p => ({ pointId: p.id, time: 1000 + p.distance / 2 })) };
  return { runner, source, official };
}

describe('Source LiveTrail', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('identifie la course et l’édition, sans reprendre la pagination du lien', () => {
    expect(parseLiveTrailUrl(url)).toEqual({ tenant: 'example_2026', raceId: 'TR', url: 'https://example.v3.livetrail.net/fr/2026/passings-table?raceId=TR' });
    expect(parseLiveTrailUrl('https://example.v3.livetrail.net/fr/2026/races/TR').raceId).toBe('TR');
  });
  it('refuse les domaines arbitraires, anciens formats et liens incomplets', () => {
    for (const input of ['not a url', 'http://example.v3.livetrail.net/fr/2026?raceId=TR', 'https://example.v3.livetrail.net.evil.test/fr/2026?raceId=TR', 'https://example.v3.livetrail.net/fr/2026', 'https://example.v3.livetrail.net/fr/2026?raceId=../../admin']) expect(() => parseLiveTrailUrl(input)).toThrow();
  });
  it('décode le parcours officiel et refuse des distances non monotones', () => {
    expect(decodeTrack({ segments: [{ segment: [[0, 100, [2, 43]], [100, 120, [2, 43.001]]] }] })).toHaveLength(2);
    expect(() => decodeTrack({ segments: [{ segment: [[0, 100, [2, 43]], [100, 100, [2, 43]], [50, 100, [2, 43]]] }] })).toThrow();
  });
  it('respecte les offsets ISO et utilise l’arrivée, pas la sortie du contrôle', () => {
    const { source } = fixture();
    const rows = decodeEntrants({ rows: [{ runner: { bib: 42, firstName: '', lastName: '' }, passingsByPointId: { '0': { datetimeOut: '2026-10-24T03:59:47+02:00' }, '4': { datetimeIn: '2026-10-24T10:00:00+02:00', datetimeOut: '2026-10-24T10:45:00+02:00' } } }] }, source.points, 0);
    expect(rows[0].start).toBe(Date.parse('2026-10-24T01:59:47Z') / 1000);
    expect(rows[0].finish).toBe(Date.parse('2026-10-24T08:00:00Z') / 1000);
    expect(rows[0].name).toBe('Dossard 42');
    expect(() => decodeEntrants({ rows: [{ runner: { bib: 42 }, passingsByPointId: { '0': { datetimeOut: '2026-10-24T03:59:47' } } }] }, source.points, 0)).toThrow('fuseau');
  });
  it('charge toutes les pages et ne transmet aucun fichier ni identifiant privé', async () => {
    const { source } = fixture();
    const rawRows = (bib: number) => ({ runner: { bib, firstName: 'Test', lastName: String(bib) }, passingsByPointId: {} });
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      let body: unknown;
      if (url.includes('global-event')) body = { name: 'Test', timezone: 'Europe/Paris' };
      else if (url.includes('/races/')) body = { startDate: '2026-10-24T03:59:47+02:00', fullName: 'Trail', trackUrl: 'https://livetrailv3.s3.gra.io.cloud.ovh.net/test.json' };
      else if (url.includes('/points?')) body = source.points.map(p => ({ pointId: p.id, name: p.name, distance: p.distance, lat: p.lat, lon: p.lon, services: p.aid ? ['AID_STATION'] : [] }));
      else if (url.includes('/passings/')) body = { rows: [rawRows(url.includes('page=0') ? 1 : 2)], total: 2 };
      else body = { segments: [{ segment: source.route.map(p => [p.distance, p.alt, [p.lon, p.lat]]) }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const race = await loadLiveTrail(url);
    expect(race.entrants.map(r => r.bib)).toEqual(['1', '2']);
    expect(calls.filter(c => c.url.includes('/passings/'))).toHaveLength(2);
    expect(calls.every(c => !c.init?.body && c.init?.credentials === 'omit')).toBe(true);
    expect(calls.find(c => c.url.includes('/races/'))?.init?.headers).toEqual({ 'X-Tenant': 'example_2026' });
  });
  it('explique une erreur HTTP plutôt que de construire un replay vide', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await expect(loadLiveTrail(url)).rejects.toThrow('503');
  });
});

describe('Recalage sur les pointages', () => {
  it('corrige deux heures avec une constante sans modifier les données sources', () => {
    const { runner, official, source } = fixture(), before = JSON.stringify(runner);
    const c = calibrate(runner, official, source);
    expect(c.reliable).toBe(true); expect(c.offset).toBe(-7200); expect(c.spread).toBe(0); expect(c.anchors).toHaveLength(3);
    expect(JSON.stringify(runner)).toBe(before);
    const r = { ...runner, offset: c.offset, official };
    expect(calibrationIssues(r, source)).toEqual([]);
    expect(stateAt(projectRunner(r, source.route), 120, source.start).distance).toBeCloseTo(240, 0);
  });
  it('ne corrige pas quelques secondes de bruit GPS comme une erreur d’horloge', () => {
    const { runner, official, source } = fixture();
    official.passings.forEach(p => { p.time += 12; });
    expect(calibrate(runner, official, source).offset).toBe(-7200);
  });
  it('refuse un mauvais coureur ou une dérive qui nécessiterait d’étirer le temps', () => {
    const { runner, official, source } = fixture();
    official.passings[2].time += 180; official.passings[3].time += 500;
    expect(calibrate(runner, official, source).reliable).toBe(false);
    expect(calibrate(runner, { ...official, passings: official.passings.slice(0, 2) }, source).reliable).toBe(false);
  });
  it('détecte une mauvaise correction manuelle malgré la bonne association', () => {
    const { runner, official, source } = fixture();
    expect(calibrationIssues({ ...runner, official, offset: 0 }, source)).not.toEqual([]);
  });
  it('ignore le moment de démarrage de la montre et ne remplace pas la fin officielle par son arrêt', () => {
    const { runner, official, source } = fixture();
    const p = projectRunner({ ...runner, offset: -7200, official: { ...official, finish: 1900 } }, source.route);
    expect(stateAt(p, 899, source.start).finished).toBe(false);
    expect(stateAt(p, 900, source.start).finished).toBe(true);
    expect(stateAt(p, 1200, source.start).distance).toBeCloseTo(stateAt(p, 900, source.start).distance, 5);
    const unfinished = projectRunner({ ...runner, offset: -7200, official: { ...official, finish: undefined, passings: official.passings.slice(0, -1) } }, source.route);
    expect(stateAt(unfinished, 2000, source.start).recordingEnded).toBe(true);
    expect(stateAt(unfinished, 2000, source.start).finished).toBe(false);
  });
  it('exporte les données officielles nécessaires à une réouverture sans réseau', async () => {
    const { runner, official, source } = fixture();
    const a = { ...runner, offset: -7200, official }, b = { ...a, id: 'other', official: { ...official, bib: '43' } };
    const project: Project = { version: 1, title: 'Test', runners: [a, b], referenceId: a.id, stations: officialStations(source), liveTrail: source };
    const restored = await readProject(new File([JSON.stringify(project)], 'test.racereplay'));
    expect(restored.liveTrail).toEqual(source); expect(restored.runners[0].offset).toBe(-7200); expect(restored.runners[0].calibration?.reliable).toBe(true);
    source.route[1].distance = -1;
    expect(() => validateSavedSource(source, [a, b])).toThrow();
  });
  it('conserve les repères manuels des anciens replays à la même position GPS', () => {
    const { runner, source } = fixture();
    const old: Project = { version: 1, title: 'Ancien replay', runners: [runner, { ...runner, id: 'other' }], referenceId: runner.id, stations: [{ id: 'manual', name: 'Mon repère', distance: 700, automatic: false, support: 0 }, { id: 'auto', name: 'Ancienne détection', distance: 500, automatic: true, support: 2 }] };
    const result = transferManualStations(old, source);
    expect(result).toHaveLength(1); expect(result[0].name).toBe('Mon repère'); expect(result[0].distance).toBeCloseTo(700, 0);
  });
});
