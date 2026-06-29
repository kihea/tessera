// Terminal backdrop: a phosphor-green CRT. Pure CSS layers (.term-* in
// styles.css) -- a soft green glow, fine scanlines, a slow scan sweep, and a
// vignette -- so it stays crisp at any resolution. Decorative (aria-hidden);
// prefers-reduced-motion disables the sweep/flicker via the stylesheet.
export function TerminalBackground() {
  return (
    <div className="term-bg" aria-hidden="true">
      <div className="term-glow" />
      <div className="term-scanlines" />
      <div className="term-sweep" />
      <div className="term-vignette" />
    </div>
  );
}
