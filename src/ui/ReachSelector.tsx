import { useEffect, useRef, useState } from 'react';
import { REACH_LEVELS, nearestReach } from './labels';

// Branch-out reach as a dropdown that mirrors the model selector, for UX
// cohesion: the trigger shows the current stop (Focused -> Far-reaching), the
// popover lists all five with their blurbs. The engine still reads the 0..1
// radius each stop carries. The "↳" glyph is the same one the research view
// uses to mark a branch.

export function ReachSelector({
  radius,
  onChange,
}: {
  radius: number;
  onChange: (radius: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = nearestReach(radius);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="reach-toggle" ref={ref}>
      <button
        type="button"
        className="model-toggle-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`Branch-out reach — ${active.blurb}`}
      >
        <span className="mt-diamond">↳</span>
        <span className="mt-name">{active.label}</span>
        <span className="mt-caret">▾</span>
      </button>
      {open && (
        <div className="model-pop reach-pop" role="dialog" aria-label="Branch-out reach">
          <div className="reach-opts" role="radiogroup" aria-label="Branch-out reach">
            {REACH_LEVELS.map((lvl) => (
              <button
                key={lvl.key}
                type="button"
                role="radio"
                aria-checked={lvl.key === active.key}
                className={`reach-opt ${lvl.key === active.key ? 'on' : ''}`}
                onClick={() => {
                  onChange(lvl.radius);
                  setOpen(false);
                }}
              >
                <span className="reach-opt-name">{lvl.label}</span>
                <span className="reach-opt-blurb">{lvl.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
