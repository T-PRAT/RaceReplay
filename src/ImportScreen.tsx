import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, FolderOpen, Mountain, Plus, Route, ShieldCheck, Upload, Users } from 'lucide-react';
import type { LiveTrailRace } from './model';
import SourceForm from './SourceForm';
import { ThemeToggle } from './theme';

export function Brand() {
  return <a href="/" className="brand" onClick={e => e.preventDefault()} aria-label="RaceReplay"><span className="brand-icon"><Mountain size={23} strokeWidth={1.7} /></span>race<span className="brand-light">replay</span><span className="beta">BÊTA</span></a>;
}

function Terrain() {
  return <svg className="terrain-art" viewBox="0 0 650 690" aria-hidden="true">
    <defs><radialGradient id="terrainGlow"><stop stopColor="#e3e9cd" /><stop offset="1" stopColor="#f2f2e8" /></radialGradient></defs>
    <rect width="650" height="690" fill="url(#terrainGlow)" />
    {Array.from({ length: 30 }, (_, i) => <path key={i} d={`M ${-240 + i * 18} -30 C ${140 + i * 9} 70, ${-80 + i * 13} 170, ${190 + i * 14} 290 S ${120 + i * 14} 490, ${550 + i * 10} 760`} fill="none" stroke={i % 4 === 0 ? '#c8cfb8' : '#d8ddca'} strokeWidth={i % 4 === 0 ? 1.2 : .7} />)}
    <path d="M126 518 C80 450 173 418 200 424 S198 335 264 350 S321 290 304 236 S389 197 414 230 S468 227 489 191" stroke="#fcfcf5" strokeWidth="10" fill="none" />
    <path d="M126 518 C80 450 173 418 200 424 S198 335 264 350 S321 290 304 236 S389 197 414 230 S468 227 489 191" stroke="#607e50" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    <g fill="#556c4b" fontSize="11" letterSpacing="2"><text x="73" y="558">LE DÉPART</text><text x="448" y="160">LE SOMMET</text><text x="381" y="380" opacity=".55" transform="rotate(-20 381 380)">LES CRÊTES</text></g>
    <circle cx="126" cy="518" r="6" fill="#244d3e" stroke="white" strokeWidth="3" /><circle cx="489" cy="191" r="6" fill="#244d3e" stroke="white" strokeWidth="3" />
    <g><rect x="256" y="244" width="210" height="56" rx="12" fill="white" /><circle cx="277" cy="270" r="6" fill="#e47748" /><text x="292" y="268" fill="#233d32" fontSize="13" fontWeight="600">La course, au bon rythme.</text><text x="292" y="285" fill="#8b9483" fontSize="11">GPS + pointages officiels</text><path d="m303 300 7 8 7-8" fill="white" /></g>
    <circle cx="310" cy="317" r="9" fill="#e47748" stroke="white" strokeWidth="3" /><circle cx="284" cy="349" r="8" fill="#487fbe" stroke="white" strokeWidth="3" /><circle cx="250" cy="352" r="8" fill="#8b70b2" stroke="white" strokeWidth="3" />
  </svg>;
}

export default function ImportScreen({ race, onLoad, onFiles, busy, error }: { race: LiveTrailRace | null; onLoad: (url: string) => void; onFiles: (files: File[]) => void; busy: boolean; error: string }) {
  const input = useRef<HTMLInputElement>(null), replay = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return <>
    <header className="site-header"><Brand /><div className="header-actions"><span className="header-note"><span className="status-dot" />Sans compte. Juste la course.</span><ThemeToggle /></div></header>
    <main className="landing"><section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span />LE REPLAY DE VOS AVENTURES</div><h1>La ligne d’arrivée<br />n’est que le <em>début.</em></h1>
        <p className="hero-description">Un lien LiveTrail, les FIT de vos amis.<br />Une seule course. Les bonnes horloges.</p>
        <SourceForm race={race} busy={busy} onLoad={onLoad} />
        <div className={`upload-zone ${drag ? 'dragging' : ''} ${!race ? 'upload-waiting' : ''}`} onDragOver={e => { e.preventDefault(); if (race) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) onFiles(Array.from(e.dataTransfer.files)); }}>
          <span className="upload-icon"><Upload size={23} strokeWidth={1.5} /></span><strong>Vos traces. Votre course.</strong>
          <p>{race ? 'Glissez les fichiers GPS ici, puis associez les coureurs' : 'Chargez d’abord le lien LiveTrail ci-dessus'}</p>
          <button className="button primary" disabled={busy || !race} onClick={() => input.current?.click()}><Plus size={17} />Importer les activités<ArrowRight size={17} /></button>
          <span className="file-hint">2 à 10 coureurs · FIT recommandé · GPX / TCX horodatés acceptés</span>
          <input ref={input} type="file" multiple accept=".fit,.gpx,.tcx" hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div>
        {error && <div role="alert" className="error-box">{error}</div>}
        <div className="privacy"><ShieldCheck size={15} /><span>Aucun envoi de vos fichiers GPS.</span></div>
        <button className="text-button open-replay" disabled={busy} onClick={() => replay.current?.click()}><FolderOpen size={16} />Déjà un replay ? Ouvrir un fichier<ArrowRight size={14} /></button>
        <input ref={replay} hidden type="file" accept=".racereplay" onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      <div className="hero-visual"><Terrain /><div className="visual-label"><span className="status-dot" />L’aventure se rejoue à plusieurs.</div><span className="coordinate">GPS × LIVETRAIL</span></div>
    </section>
    <section className="feature-strip"><div><span className="feature-number">01</span><div><h3>Rassemblez les traces</h3><p>La course LiveTrail et les FIT des amis.</p></div><Users size={23} /></div><div><span className="feature-number">02</span><div><h3>Retrouvez le bon tempo</h3><p>Des horloges vérifiées aux contrôles.</p></div><Route size={23} /></div><div><span className="feature-number">03</span><div><h3>Partagez l’histoire</h3><p>Un replay à envoyer. Sans inscription.</p></div><ArrowDownToLine size={23} /></div></section>
    </main><footer className="site-footer"><span>Pour les courses qu’on n’a pas fini de raconter.</span><span>Fait pour courir ensemble <Mountain size={14} /></span></footer>
  </>;
}
