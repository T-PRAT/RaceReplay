import { useEffect, useState } from 'react';
import type { LiveTrailRace, Project, Runner } from './model';
import { importActivity, readProject } from './import';
import { suggestReferenceId } from './race';
import { finishingRanks, loadLiveTrail } from './livetrail';
import { calibrate, calibrationIssues, officialStations, transferManualStations } from './calibration';
import ImportScreen from './ImportScreen';
import Setup from './Setup';
import Replay from './Replay';

export default function App() {
  const [project, setProject] = useState<Project | null>(null), [pending, setPending] = useState<Runner[] | null>(null);
  const [race, setRace] = useState<LiveTrailRace | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  async function loadSource(url: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const data = await loadLiveTrail(url), same = race?.url === data.url;
      setRace(data);
      setPending(rs => rs?.map(r => {
        const normalize = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const matches = data.entrants.filter(e => normalize(e.name) === normalize(r.name));
        const official = same && r.official ? data.entrants.find(e => e.bib === r.official!.bib) : matches.length === 1 ? matches[0] : undefined;
        const calibration = official ? calibrate(r, official, data) : undefined;
        return { ...r, official, calibration, offset: calibration?.offset ?? 0 };
      }) ?? null);
      setRevision(r => r + 1);
    } catch (err) { setError(err instanceof Error && !(err instanceof TypeError) ? err.message : 'Impossible de contacter LiveTrail. Vérifie ta connexion et le lien, puis réessaie.'); }
    finally { setBusy(false); }
  }
  async function handleFiles(files: File[]) {
    if (!files.length || busy) return;
    setError(''); setBusy(true);
    try {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.racereplay')) {
        const loaded = await readProject(files[0]);
        setProject(loaded);
        if (loaded.liveTrail) {
          setRace({ ...loaded.liveTrail, entrants: loaded.runners.map(r => r.official!) });
          setPending(loaded.runners.every(r => !calibrationIssues(r, loaded.liveTrail!).length) ? null : loaded.runners);
        } else {
          setRace(null); setPending(loaded.runners);
          setError('Cet ancien replay n’a pas de source LiveTrail. Ajoute le lien de la course pour vérifier ses horloges ; les fichiers et noms sont conservés.');
        }
      } else {
        if (!race) throw new Error('Charge d’abord le lien LiveTrail de la course.');
        if (files.length < 2 || files.length > 10) throw new Error('Sélectionne entre 2 et 10 activités pour comparer les coureurs.');
        const rs: Runner[] = [];
        for (let i = 0; i < files.length; i++) { await new Promise(resolve => setTimeout(resolve, 20)); rs.push(await importActivity(files[i], i)); }
        setPending(rs);
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function ready(runners: Runner[], title: string, meId?: string) {
    if (!race || busy) return;
    setBusy(true); setError('');
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      const issues = runners.flatMap(r => calibrationIssues(r, race).map(issue => `${r.fileName} : ${issue}`));
      if (new Set(runners.map(r => r.official?.bib)).size !== runners.length) throw new Error('Chaque fichier doit correspondre à un dossard différent.');
      if (issues.length) throw new Error(issues.join(' '));
      const { entrants, ...base } = race, ranks = finishingRanks(entrants);
      const source = { ...base, finishers: ranks.size };
      runners = runners.map(r => { const rank = ranks.get(r.official!.bib); return { ...r, official: { ...r.official!, ...(rank ? { rank } : {}) } }; });
      const sameSource = project?.liveTrail?.url === source.url;
      const stations = sameSource ? project.stations : [...officialStations(source), ...(project ? transferManualStations(project, source) : [])].sort((a, b) => a.distance - b.distance);
      setProject({ version: 1, title, runners, referenceId: suggestReferenceId(runners), meId: runners.some(r => r.id === meId) ? meId : undefined, liveTrail: source, stations });
      setPending(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (project || pending) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [project, pending]);
  if (pending) return <Setup key={`${race?.url}:${revision}`} initial={pending} race={race} initialTitle={project?.title ?? race?.raceName ?? 'Notre course'} initialMe={project?.meId} onLoad={loadSource} onCancel={() => { setPending(null); if (!project?.liveTrail) setProject(null); setError(''); }} onReady={ready} error={error} busy={busy} />;
  if (project?.liveTrail) return <Replay project={project} onProject={setProject} onEdit={() => { setPending(project.runners); setError(''); if (race && race.entrants.length <= project.runners.length) void loadSource(project.liveTrail!.url); }} onNew={() => { if (window.confirm('As-tu exporté ton replay ? Revenir à l’import effacera le replay de cette page.')) { setProject(null); setError(''); } }} />;
  return <ImportScreen race={race} onLoad={loadSource} onFiles={handleFiles} busy={busy} error={error} />;
}
