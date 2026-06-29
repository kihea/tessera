import { useEffect, useRef } from 'react';

// The user's fluid raymarch shader ("fluidtester1", Shadertoy-style), wrapped as a
// WebGL backdrop for the Fluid theme. Decorative (aria-hidden). Honors
// prefers-reduced-motion (draws a single static frame), pauses when the tab is
// hidden, caps DPR for performance, and falls back to the flat --bg if WebGL or
// shader compilation fails.

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// Original fragment shader body + a Shadertoy->WebGL main() wrapper and uniforms.
const FRAG = `
precision mediump float;
uniform vec3 iResolution;
uniform float iTime;
#define t iTime
mat2 m(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float map(vec3 p){
  p.xz *= m(t * 0.4);
  p.xy *= m(t * 0.3);
  vec3 q = p * 2. + t;
  vec3 o = vec3(sin(t * 0.7));
  return length(p + o) * log(length(p) + 1.) + cos(q.x + sin(q.y + cos(q.z))) * 0.5 - 1.;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord.xy / min(iResolution.y, iResolution.x);
  uv.x -= 1.;
  uv.y -= 0.5;
  vec3 col = vec3(0.);
  float delta = 0.3;
  for (int i = 0; i <= 5; i++) {
    vec3 p3d = vec3(0, 0, 3.) + normalize(vec3(uv, -1.)) * delta;
    float rz = map(p3d);
    float f = clamp((rz - map(p3d + .3)) * 0.5, -.1, 1.);
    vec3 base = vec3(0.2, 0.5, 0.6) + vec3(4, 5, 5) * f;
    col = col * base + smoothstep(2.5, .0, rz) * .7 * base;
    delta += min(rz, 1.);
  }
  fragColor = vec4(col, 1.0);
}
void main(){ vec4 c; mainImage(c, gl_FragCoord.xy); gl_FragColor = vec4(c.rgb, 1.0); }
`;

export function FluidBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false });
    if (!gl) return;

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'iResolution');
    const uTime = gl.getUniformLocation(prog, 'iTime');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap for fill-rate
    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform3f(uRes, w, h, 1);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    if (reduce) {
      gl.uniform1f(uTime, 6); // a single pleasant static frame
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      raf = requestAnimationFrame(draw);
    }
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className="fluid-bg" aria-hidden="true" />;
}
