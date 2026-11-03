import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

// index.html applies the saved or system theme before the first paint.
export type Theme = 'light' | 'dark';
const KEY = 'racereplay-theme', listeners = new Set<() => void>();
const current = (): Theme => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1412' : '#183e34');
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: the choice lasts for the tab */ }
  listeners.forEach(l => l());
}
export function useTheme() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, current);
}
export function ThemeToggle() {
  const theme = useTheme();
  return <button className="icon-button theme-toggle" aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>;
}
