import { useEffect, useRef } from 'react';

// Ambient, interactive "weave" backdrop. Tendrils grow and branch from the
// edges the way a study map branches from an idea, drawn onto a persistent
// canvas with a slow per-frame fade so each growing tip leaves a glowing trail.
// The pointer bends nearby tips toward it, so the field feels alive without
// demanding attention. The whole thing is decorative (aria-hidden) and degrades
// gracefully: prefers-reduced-motion paints one settled field and stops; a
// hidden tab pauses the loop; everything is cleaned up on unmount.
//
// `reach` (0..1, the branch-out reach the learner sets) tunes how eagerly the
// tendrils split and how many grow at once -- so the backdrop literally
// branches more when you ask the engine to reach further.

interface Tip {
  x: number;
  y: number;
  a: number; // heading, radians
  speed: number; // px/sec
  life: number;
  max: number; // seconds before it fades out
  depth: number;
  width: number;
  hue: number; // small offset off the accent, for subtle variety
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return { r: 110, g: 168, b: 254 };
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  return { r, g, b };
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function WeaveBackground({ reach = 0.5 }: { reach?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reachRef = useRef(reach);
  reachRef.current = reach;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const bg = hexToRgb(css.getPropertyValue('--bg').trim() || '#0d1117');
    const accent = hexToRgb(css.getPropertyValue('--accent').trim() || '#6ea8fe');

    let w = 0;
    let h = 0;
    const pointer = { x: -9999, y: -9999, active: false };
    let tips: Tip[] = [];
    const MAX_TIPS = 110;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function seed(): Tip {
      const edge = Math.floor(rand(0, 4));
      let x = 0;
      let y = 0;
      let a = 0;
      if (edge === 0) {
        x = rand(0, w);
        y = -10;
        a = rand(Math.PI * 0.25, Math.PI * 0.75);
      } else if (edge === 1) {
        x = w + 10;
        y = rand(0, h);
        a = rand(Math.PI * 0.75, Math.PI * 1.25);
      } else if (edge === 2) {
        x = rand(0, w);
        y = h + 10;
        a = rand(Math.PI * 1.25, Math.PI * 1.75);
      } else {
        x = -10;
        y = rand(0, h);
        a = rand(-Math.PI * 0.25, Math.PI * 0.25);
      }
      return { x, y, a, speed: rand(14, 30), life: 0, max: rand(3.5, 7), depth: 0, width: rand(1.1, 2.2), hue: rand(-25, 45) };
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
      ctx!.fillRect(0, 0, w, h);
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function step(dt: number) {
      // Translucent wash over the whole canvas each frame: old strokes fully
      // fade back to the background within ~a second, so tendrils read as
      // growing comet-trails that fade after a while rather than accumulating
      // into a permanent static haze.
      ctx!.fillStyle = `rgba(${bg.r},${bg.g},${bg.b},0.1)`;
      ctx!.fillRect(0, 0, w, h);

      const reachNow = reachRef.current;
      const splitRate = 0.45 + reachNow * 1.7; // splits/sec, scaled by reach
      const next: Tip[] = [];
      ctx!.lineCap = 'round';

      for (const t of tips) {
        const px = t.x;
        const py = t.y;

        if (pointer.active) {
          const dx = pointer.x - t.x;
          const dy = pointer.y - t.y;
          const d2 = dx * dx + dy * dy;
          const R = 190;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1;
            const target = Math.atan2(dy, dx);
            let diff = target - t.a;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest turn
            t.a += diff * 0.07 * (1 - d / R);
          }
        }
        t.a += rand(-0.6, 0.6) * dt; // organic wander
        t.x += Math.cos(t.a) * t.speed * dt;
        t.y += Math.sin(t.a) * t.speed * dt;
        t.life += dt;

        const env = Math.sin(Math.min(1, t.life / t.max) * Math.PI); // 0 -> 1 -> 0
        const alpha = 0.62 * env; // brighter at peak to read before the faster fade clears it
        ctx!.strokeStyle = `rgba(${clampByte(accent.r + t.hue)},${accent.g},${clampByte(accent.b - t.hue * 0.5)},${alpha})`;
        ctx!.lineWidth = t.width * env + 0.2;
        ctx!.beginPath();
        ctx!.moveTo(px, py);
        ctx!.lineTo(t.x, t.y);
        ctx!.stroke();

        const onStage = t.x > -50 && t.x < w + 50 && t.y > -50 && t.y < h + 50;
        if (t.life < t.max && onStage) {
          next.push(t);
          if (t.depth < 4 && next.length + tips.length < MAX_TIPS && Math.random() < splitRate * dt) {
            next.push({
              x: t.x,
              y: t.y,
              a: t.a + rand(0.4, 0.95) * (Math.random() < 0.5 ? -1 : 1),
              speed: t.speed * rand(0.7, 0.95),
              life: 0,
              max: t.max * rand(0.5, 0.8),
              depth: t.depth + 1,
              width: t.width * 0.7,
              hue: t.hue + rand(-12, 12),
            });
          }
        }
      }
      tips = next;
      const target = 9 + Math.round(reachNow * 11); // more live tendrils at higher reach
      while (tips.length < target) tips.push(seed());
    }

    let raf = 0;
    let last = 0;
    function frame(ts: number) {
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
      last = ts;
      step(dt);
      raf = requestAnimationFrame(frame);
    }

    resize();
    for (let i = 0; i < 14; i++) tips.push(seed());
    if (reduced) {
      for (let i = 0; i < 150; i++) step(0.05); // settle a static field, then stop
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => resize();
    const onMove = (e: PointerEvent) => {
      const r = canvas!.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
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
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="weave-bg" aria-hidden="true" />;
}
