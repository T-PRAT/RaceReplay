import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { uid, type Station } from './model';

export default function StationEditor({ stations, total, onChange, onClose }: { stations: Station[]; total: number; onChange: (stations: Station[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(stations);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select') ?? []);
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label="Modifier les repères" onClick={e => e.stopPropagation()}>
    <div className="section-heading"><div><div className="eyebrow">LES POINTS DE PASSAGE</div><h2>Ravitos & repères</h2></div><button className="icon-button" onClick={onClose} aria-label="Fermer"><X size={20} /></button></div>
    <p className="small muted">Les contrôles officiels viennent de LiveTrail. Ajouter ou modifier un repère ne change jamais les pointages ni le recalage des montres. Un contrôle déplacé devient un repère manuel.</p>
    <div className="station-list">{draft.map((s, i) => <div className="station-edit" key={s.id}>
      <span className="station-index">{i + 1}</span>
      <label className="field">NOM<input value={s.name} maxLength={50} onChange={e => setDraft(ds => ds.map(x => x.id === s.id ? { ...x, name: e.target.value, automatic: false, official: false } : x))} /></label>
      <label className="field">KILOMÈTRE<input type="number" min={.1} max={total / 1000 - .1} step={.1} value={Math.round(s.distance / 100) / 10} onChange={e => setDraft(ds => ds.map(x => x.id === s.id ? { ...x, distance: Number(e.target.value) * 1000, automatic: false, official: false } : x))} /></label>
      <button className="icon-button" aria-label={`Supprimer ${s.name}`} onClick={() => setDraft(ds => ds.filter(x => x.id !== s.id))}><Trash2 size={17} /></button>
      <span className="station-confidence small">{s.official ? 'Contrôle officiel LiveTrail' : 'Repère manuel'}</span>
    </div>)}</div>
    <button className="text-button" disabled={draft.length >= 50} onClick={() => setDraft(ds => [...ds, { id: uid(), name: `Repère ${ds.length + 1}`, distance: Math.round(total / 2), automatic: false, support: 0 }])}><Plus size={16} />Ajouter un repère</button>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>Annuler</button><button className="button primary" disabled={draft.some(s => !s.name.trim() || s.distance <= 0 || s.distance >= total)} onClick={() => { onChange(draft.sort((a, b) => a.distance - b.distance)); onClose(); }}>Enregistrer<Check size={16} /></button></div>
  </section></div>;
}
