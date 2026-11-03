import { useState } from 'react';
import { ArrowRight, Check, Link2 } from 'lucide-react';
import { localTime, type LiveTrailRace } from './model';

export default function SourceForm({ race, busy, onLoad }: { race: LiveTrailRace | null; busy: boolean; onLoad: (url: string) => void }) {
  const [url, setUrl] = useState(race?.url ?? '');
  return <div className="source-form">
    <label className="field">LE LIEN LIVETRAIL DE LA COURSE
      <div className="source-input"><Link2 size={17} /><input type="url" placeholder="https://evenement.v3.livetrail.net/…?raceId=…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) onLoad(url); }} disabled={busy} /></div>
    </label>
    <button className="button secondary" disabled={busy || !url.trim()} onClick={() => onLoad(url)}>{busy ? 'Chargement…' : race?.url === url ? 'Actualiser les pointages' : 'Charger la course'}<ArrowRight size={15} /></button>
    {race && <div className="source-connected" role="status"><Check size={16} /><div><strong>{race.raceName}</strong><span>{race.entrants.length} participants · {race.points.length} contrôles · départ {localTime(race.start, race.timeZone)} ({race.timeZone})</span></div></div>}
    <p className="small muted">Les horaires et le parcours viennent de LiveTrail. Vos fichiers GPS restent dans votre navigateur.</p>
  </div>;
}
