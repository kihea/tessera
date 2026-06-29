import { useEffect, useState } from 'react';
import type { ThemeName } from '../state/storage';
import { WeaveBackground } from './WeaveBackground';
import { AlexandriaBackground } from './AlexandriaBackground';
import { TerminalBackground } from './TerminalBackground';
import { FluidBackground } from './FluidBackground';

// Picks the backdrop that matches the active theme, so each theme has its own
// vibe rather than the same beams in different colors: Standard keeps the
// branching weave, Library of Alexandria gets a candlelit parchment room, and
// Terminal gets a CRT. A MutationObserver on <html data-theme> swaps the backdrop
// the instant the theme changes (e.g. live preview in Settings), with no reload.

function readTheme(): ThemeName {
  const t = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  return t === 'alexandria' || t === 'terminal' || t === 'light' || t === 'dark' || t === 'fluid'
    ? t
    : 'standard';
}

export function ThemeBackground({ reach = 0.5 }: { reach?: number }) {
  const [theme, setTheme] = useState<ThemeName>(() => readTheme());

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // `key` forces a fresh mount per theme so each backdrop re-reads CSS variables
  // and restarts its animation cleanly.
  if (theme === 'alexandria') return <AlexandriaBackground key="alexandria" />;
  if (theme === 'terminal') return <TerminalBackground key="terminal" />;
  if (theme === 'fluid') return <FluidBackground key="fluid" />;
  // Clean modern themes: no animated backdrop -- the flat --bg is the look.
  if (theme === 'light' || theme === 'dark') return null;
  return <WeaveBackground key="standard" reach={reach} />;
}
