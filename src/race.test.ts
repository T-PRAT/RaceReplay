import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { importActivity, readProject } from './import';
import { aidStops, cadenceScale, channelMean, climb, detectStations, detectStops, raceSummary, elevationGain, gradeAdjuster, gradeFactor, haversine, liveGap, makeRoute, projectRunner, recentPace, replayOrigin, startTime, stateAt, suggestReferenceId, timeAt, zoneStats } from './race';
import { heat, heatDelta, shortGap } from './Heat';
import { finishingRanks } from './livetrail';
import type { LiveTrailSource, Project, Runner } from './model';

const runner = (id = 'a', delay = 0): Runner => ({ id, name: id, fileName: `${id}.fit`, color: '#e47748', offset: 0, warnings: [], points: Array.from({ length: 101 }, (_, i) => ({ lat: 43 + i * .0001, lon: 2, alt: 100 + i, time: 1000 + delay + i * 5, distance: i * 11.12 })) });

describe('Moteur de replay', () => {
  it('calcule les distances géographiques', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111195, 0);
  });
  it('projette une trace sans recul et interpole les passages', () => {
    const r = runner(), projected = projectRunner(r, makeRoute(r));
    expect(projected.progress.at(-1)).toBeCloseTo(1112, 0);
    expect(timeAt(projected, 556)).toBeCloseTo(1250, 0);
    expect(timeAt(projected, 2000)).toBeNaN();
    expect(projected.offCourse).toBe(0);
    expect(projected.progress.every((p, i, a) => i === 0 || p >= a[i - 1])).toBe(true);
  });
  it('préserve une horloge commune et les corrections de fuseau', () => {
    const a = runner(), b = runner('b', 7200); b.offset = -7200;
    expect(startTime(b, 1000)).toBe(0);
    b.offset = 0;
    expect(startTime(b, 1000)).toBe(7200);
    const p = projectRunner(b, makeRoute(a));
    expect(stateAt(p, 100, 1000).pending).toBe(true);
    expect(stateAt(p, 7300, 1000).distance).toBeCloseTo(222.4, 0);
    expect(stateAt(p, 9999, 1000).finished).toBe(true);
  });
  it('ne pénalise pas le coureur ayant lancé sa montre une minute avant le départ groupé', () => {
    const make = (id: string, first: number, speed: number) => ({ ...runner(id), points: Array.from({ length: 500 }, (_, i) => {
      const time = first + i, distance = Math.max(0, time - 1000) * speed;
      return { time, distance, lat: 43 + distance / 111195, lon: 2, alt: 100 };
    }) });
    const early = make('early', 940, 4), normal = make('normal', 1000, 3), late = make('late', 1040, 4);
    const route = makeRoute(early), rs = [early, normal, late].map(r => projectRunner(r, route));
    const origin = replayOrigin(rs);
    expect(origin).toBe(1000);
    const leader = stateAt(rs[0], 120, origin), other = stateAt(rs[1], 120, origin);
    expect(leader.distance).toBeCloseTo(480, 0);
    expect(other.distance).toBeCloseTo(360, 0);
    expect(stateAt(rs[2], 120, origin).distance).toBeCloseTo(leader.distance, 0);
    expect(stateAt(rs[2], 0, origin).pending).toBe(true);
    expect(timeAt(rs[2], 100)).toBeNaN();
    expect(timeAt(rs[0], 0)).toBe(1000); // Pas 940 : l’attente avant de partir n’est pas un écart.
    expect(timeAt(rs[1], 0)).toBe(1000);
    expect(timeAt(rs[1], 300) - timeAt(rs[0], 300)).toBeCloseTo(25, 0);
    early.offset = 7200; early.points.forEach(p => { p.time -= 7200; });
    expect(stateAt(projectRunner(early, route), 120, origin).distance).toBeCloseTo(leader.distance, 0);
  });
  it('ne prétend pas connaître un passage situé avant le premier GPS enregistré', () => {
    const ref = runner(), late = runner('late'); late.points = late.points.slice(10);
    const p = projectRunner(late, makeRoute(ref));
    expect(p.progress[0]).toBeCloseTo(111.2, 0);
    expect(timeAt(p, p.progress[0] - 10)).toBeNaN();
    expect(timeAt(p, p.progress[0])).toBe(late.points[0].time);
  });
  it('recommande un départ partagé plutôt qu’une trace démarrée plus loin sur le parcours', () => {
    const a = runner(), b = runner('b'), late = runner('late'); late.points = late.points.slice(15);
    expect(suggestReferenceId([late, a, b])).not.toBe(late.id);
  });
  it('estime le dénivelé avec un seuil antibruit', () => {
    expect(elevationGain(makeRoute(runner()))).toBeGreaterThan(90);
  });
  it('détecte un arrêt commun sans supprimer le temps de pause', () => {
    const a = runner(), b = runner('b', 10);
    for (const r of [a, b]) {
      const stop = r.points[50];
      r.points.splice(51, 0, ...Array.from({ length: 20 }, (_, i) => ({ ...stop, time: stop.time + (i + 1) * 5 })));
      r.points.slice(71).forEach(p => { p.time += 100; });
    }
    const route = makeRoute(a), ps = [a, b].map(r => projectRunner(r, route));
    const stations = detectStations(ps);
    expect(stations.length).toBe(1);
    expect(stations[0].support).toBe(2);
    expect(stations[0].distance).toBeGreaterThan(500);
    expect(timeAt(ps[0], 900)).toBeGreaterThan(1490);
  });
  it('refuse un replay vide, une version inconnue ou des points mal formés', async () => {
    await expect(readProject(new File(['{}'], 'bad.racereplay'))).rejects.toThrow();
    const p: Project = { version: 1, title: 'Test', runners: [runner(), runner('b')], referenceId: 'a', stations: [] };
    const file = () => new File([JSON.stringify(p)], 'test.racereplay');
    await expect(readProject(file())).resolves.toMatchObject({ title: 'Test' });
    p.runners[0].points[1].time = 0;
    await expect(readProject(file())).rejects.toThrow('Points GPS invalides');
  });
});

describe('Effort et analyse de zone', () => {
  // Montée régulière à 10 % sur 2 km, parcourue à 2 m/s ; FC 140 puis 160 bpm.
  const route = Array.from({ length: 101 }, (_, i) => ({ lat: 43 + i * 20 / 111195, lon: 2, alt: 100 + i * 2, distance: i * 20 }));
  const climber = (official?: Runner['official']) => projectRunner({ ...runner(), official, points: Array.from({ length: 1001 }, (_, i) => ({ lat: 43 + i * 2 / 111195, lon: 2, alt: 0, time: 1000 + i, distance: i * 2, hr: i < 500 ? 140 : 160, cadence: 85 })) }, route);
  const point = (id: string, distance: number) => ({ id, name: id, distance, lat: 43 + distance / 111195, lon: 2, aid: false });
  const source: LiveTrailSource = { url: '', raceId: 'T', eventName: 'Test', raceName: 'Trail', timeZone: 'Europe/Paris', start: 1000, route, points: [point('0', 0), point('1', 1000), point('2', 2000)] };

  it('reprend les coefficients de pente de Strava, plafonnés à ±45 %', () => {
    expect(gradeFactor(0)).toBe(1);
    expect(gradeFactor(.1)).toBeCloseTo(1.459, 3);
    expect(gradeFactor(-.09)).toBeCloseTo(.876, 3);
    expect(gradeFactor(.05)).toBeCloseTo((1.135 + 1.228) / 2, 3);
    expect(gradeFactor(.8)).toBeCloseTo(4.286, 3);
  });
  it('lisse l’allure et la VAP sur 3 minutes, et pondère la FC par le temps', () => {
    const r = climber(), { pace, adjusted } = recentPace(r, 1500, gradeAdjuster(route));
    expect(pace).toBeCloseTo(500, 0);
    expect(adjusted).toBeCloseTo(500 / 1.459, 0);
    expect(recentPace(r, 1010, gradeAdjuster(route)).pace).toBeNaN();
    expect(channelMean(r, 'hr')).toBeCloseTo(150, 0);
    expect(cadenceScale(r)).toBe(2);
    const { up, down } = climb(route, 0, 2000);
    expect(Math.abs(up - 200)).toBeLessThanOrEqual(5); expect(down).toBe(0);
  });
  it('mesure une zone avec les pointages officiels, sinon avec le GPS corrigé', () => {
    const r = climber({ bib: '1', name: 'Test', start: 1000, finish: 2010, passings: [{ pointId: '0', time: 1000 }, { pointId: '1', time: 1505 }, { pointId: '2', time: 2010 }] });
    const adjust = gradeAdjuster(route);
    const official = zoneStats(r, 1000, 2000, source, adjust, []);
    expect([official.start, official.end, official.time]).toEqual([1505, 2010, 505]);
    const gps = zoneStats(r, 600, 1400, source, adjust, [{ runnerId: r.id, distance: 900, duration: 60 }, { runnerId: 'other', distance: 900, duration: 99 }]);
    expect(gps.time).toBeCloseTo(400, 0);
    expect(gps.pace).toBeCloseTo(500, 0);
    expect(gps.adjusted).toBeCloseTo(500 / 1.459, 0);
    expect(gps.hr).toBeCloseTo(150, 0);
    expect(gps.cadence).toBe(170);
    expect(gps.stopped).toBe(60);
    expect(zoneStats({ ...r, points: r.points.slice(400), progress: r.progress.slice(400) }, 200, 600, source, adjust, []).time).toBeNaN();
  });
  it('mesure les arrêts, le temps au ravito (GPS et tapis) et la VAM', () => {
    // 2 m/s sur la montée à 10 %, avec 60 s d’arrêt au ravito du kilomètre 1.
    const points = Array.from({ length: 1061 }, (_, t) => { const d = t < 500 ? 2 * t : t < 560 ? 1000 : 2 * (t - 60); return { lat: 43 + d / 111195, lon: 2, alt: 0, time: 1000 + t, distance: d, hr: 150, cadence: 85 }; });
    const r = projectRunner({ ...runner(), points, official: { bib: '1', name: 'Test', start: 1000, finish: 2060, passings: [{ pointId: '0', time: 1000 }, { pointId: '1', time: 1500, outTime: 1560 }, { pointId: '2', time: 2060 }] } }, route);
    const stops = detectStops(r);
    expect(stops).toHaveLength(1);
    expect(stops[0].duration).toBeGreaterThan(45); expect(stops[0].duration).toBeLessThanOrEqual(60);
    const aid = { ...source, points: source.points.map(p => ({ ...p, aid: p.id === '1' })) };
    expect(aidStops(r, aid, stops)).toMatchObject([{ stopped: stops[0].duration, mats: 60, reached: true }]);
    const summary = raceSummary(r, aid, gradeAdjuster(route), stops);
    expect(summary.race.time).toBe(1060);
    expect([summary.stopped, summary.aid, summary.stopCount]).toEqual([stops[0].duration, stops[0].duration, 1]);
    expect(summary.terrain.climb.vertical / summary.terrain.climb.time * 3600).toBeCloseTo(720, -1);
    expect(summary.terrain.flat.time).toBe(0);
  });
  it('classe les finishers au temps officiel', () => {
    const ranks = finishingRanks([{ bib: '1', name: 'A', start: 0, finish: 500, passings: [] }, { bib: '2', name: 'B', start: 0, passings: [] }, { bib: '3', name: 'C', start: 10, finish: 400, passings: [] }]);
    expect([...ranks]).toEqual([['3', 1], ['1', 2]]);
  });
  it('colore le temps perdu du vert au rouge, et l’écart avec moi dans les deux sens', () => {
    expect(heat(0, 300)?.background).toBe('var(--heat-best)');
    expect(heat(300, 300)).toEqual({ background: 'color-mix(in oklab, var(--heat-bad) 100%, var(--heat-min))', color: 'var(--heat-ink-strong)' });
    expect(heat(NaN, 300)).toBeUndefined();
    expect(heatDelta(-75, 300)?.background).toContain('--heat-bad');
    expect(heatDelta(75, 300)?.background).toBe('color-mix(in oklab, var(--heat-good) 50%, var(--heat-min))');
    expect(shortGap(45)).toBe('+45 s'); expect(shortGap(125)).toBe('+2:05'); expect(shortGap(3725)).toBe('+1:02:05');
    expect(shortGap(-125, true)).toBe('−2:05'); expect(shortGap(-125)).toBe('+2:05');
  });
  it('mesure l’écart avec moi au même point du parcours', () => {
    const a = projectRunner(runner('a'), route), b = projectRunner(runner('b', 50), route);
    const at = (r: typeof a, elapsed: number) => ({ ...stateAt(r, elapsed, 1000), runner: r });
    // b part 50 s après a, à la même vitesse : 50 s derrière, ou a 50 s devant b.
    expect(liveGap(at(b, 200), at(a, 200), 1200)).toBeCloseTo(50, 0);
    expect(liveGap(at(a, 200), at(b, 200), 1200)).toBeCloseTo(-50, 0);
    expect(liveGap(at(a, 200), at(a, 200), 1200)).toBe(0);
  });
});

describe('FIT réels du projet', () => {
  it('importe et compare les trois activités, sans perdre les données des montres', async () => {
    const files = (await readdir('.')).filter(f => f.endsWith('.fit'));
    if (!files.length) return; // Les FIT privés ne font pas partie du dépôt.
    const rs: Runner[] = [];
    for (const [i, f] of files.entries()) rs.push(await importActivity(new File([await readFile(f)], f), i));
    expect(rs).toHaveLength(3);
    const route = makeRoute(rs.find(r => r.fileName === 'Trail_de_nuit.fit')!);
    for (const r of rs) {
      expect(r.points.length).toBeGreaterThan(8000);
      expect(r.points[0].hr).toBeGreaterThan(0);
      expect(r.points[0].cadence).toBeGreaterThan(0);
      const p = projectRunner(r, route);
      console.log(r.fileName, { gpsKm: r.points.at(-1)!.distance / 1000, projectedKm: p.progress.at(-1)! / 1000, offCourse: p.offCourse, duration: r.points.at(-1)!.time - r.points[0].time });
      expect(p.offCourse).toBeLessThan(.1);
      expect(p.progress.at(-1)! / route.at(-1)!.distance).toBeGreaterThan(.97);
    }
  }, 30000);
  it('conserve l’avance initiale de la trace commencée avant 6 h, après correction du décalage de deux heures', async () => {
    const files = (await readdir('.')).filter(f => f.endsWith('.fit'));
    if (!files.includes('Trail_de_nuit.fit') || !files.some(f => f.startsWith('GRC_'))) return;
    const rs: Runner[] = [];
    for (const [i, file] of files.entries()) rs.push(await importActivity(new File([await readFile(file)], file), i));
    const early = rs.find(r => r.fileName.startsWith('GRC_'))!;
    early.offset = 7200; // Correction explicite du fichier de test, jamais automatique dans l’app.
    const route = makeRoute(rs.find(r => r.id === suggestReferenceId(rs))!);
    const projected = rs.map(r => projectRunner(r, route)), origin = replayOrigin(rs);
    const a = stateAt(projected.find(r => r.id === early.id)!, 180, origin);
    const b = stateAt(projected.find(r => r.fileName === 'Trail_de_nuit.fit')!, 180, origin);
    expect(a.distance).toBeGreaterThan(b.distance);
    expect(a.distance - b.distance).toBeLessThan(100);
    const late = projected.find(r => r.fileName.startsWith('Grand_Raid'))!;
    expect(late.progress[0]).toBeGreaterThan(80);
    expect(stateAt(late, 0, origin).pending).toBe(true);
  }, 30000);
});
