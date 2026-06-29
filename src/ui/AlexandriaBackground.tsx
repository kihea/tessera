import { useEffect, useRef } from 'react';

// Library of Alexandria backdrop: a quiet, candlelit reading room. The warm
// parchment gradient, grain, and vignette are CSS layers (.alex-bg in styles.css);
// this canvas adds slow-drifting dust motes caught in the candlelight. Fully
// procedural -- no image asset -- and decorative (aria-hidden). Degrades like the
// weave backdrop: prefers-reduced-motion paints one settled field; a hidden tab
// pauses; everything is cleaned up on unmount.

interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number; // px/sec
  vy: number; // px/sec (drifts gently upward)
  a: number; // base alpha
  ph: number; // twinkle phase
}

export function AlexandriaBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let motes: Mote[] = [];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      const n = Math.round(Math.min(70, (w * h) / 20000));
      motes = Array.from({ length: n }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(0.5, 2.4),
        vx: rand(-5, 5),
        vy: rand(-9, -2),
        a: rand(0.05, 0.24),
        ph: rand(0, Math.PI * 2),
      }));
    }

    function draw(dt: number, t: number) {
      ctx!.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y < -6) {
          m.y = h + 6;
          m.x = rand(0, w);
        }
        if (m.x < -6) m.x = w + 6;
        else if (m.x > w + 6) m.x = -6;
        const twinkle = 0.6 + 0.4 * Math.sin(t * 0.001 + m.ph);
        ctx!.beginPath();
        ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(196, 150, 84, ${m.a * twinkle})`; // warm candlelit gold
        ctx!.shadowColor = 'rgba(196, 150, 84, 0.9)';
        ctx!.shadowBlur = 6;
        ctx!.fill();
      }
      ctx!.shadowBlur = 0;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    function frame(ts: number) {
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
      last = ts;
      draw(dt, ts);
      raf = requestAnimationFrame(frame);
    }

    resize();
    seed();
    if (reduced) draw(0, 0);
    else raf = requestAnimationFrame(frame);

    const onResize = () => {
      resize();
      seed();
    };
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduced && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div className="alex-bg" aria-hidden="true">
      <canvas ref={ref} className="alex-motes" />
    </div>
  );
}
