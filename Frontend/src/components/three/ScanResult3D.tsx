"use client";

// 3D verdict visualization (Theme v2). Particles scattered on a sphere fly in
// and assemble into a glowing symbol — ✓ (accept, green), ✕ (reject, red) or
// a retry ring (amber) — followed by an expanding shockwave ring. Under
// prefers-reduced-motion the finished symbol renders as a single static frame.

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ScanOutcome = "accept" | "retry" | "reject";

const PARTICLES = 1400;

const OUTCOME_STYLE: Record<
  ScanOutcome,
  { color: number; glow: number; ring: number }
> = {
  accept: { color: 0x4ade80, glow: 0xbbf7d0, ring: 0x34d399 },
  retry: { color: 0xfbbf24, glow: 0xfde68a, ring: 0xf59e0b },
  reject: { color: 0xf87171, glow: 0xfecaca, ring: 0xef4444 },
};

/** Sample `count` jittered points along a polyline (2D, z jitter added). */
function samplePolyline(
  segments: Array<[[number, number], [number, number]]>,
  count: number,
): Float32Array {
  const lengths = segments.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  const total = lengths.reduce((s, l) => s + l, 0);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let d = Math.random() * total;
    let seg = 0;
    while (d > lengths[seg] && seg < segments.length - 1) {
      d -= lengths[seg];
      seg++;
    }
    const [a, b] = segments[seg];
    const t = lengths[seg] === 0 ? 0 : d / lengths[seg];
    const jitter = 0.045;
    out[i * 3] = a[0] + (b[0] - a[0]) * t + (Math.random() - 0.5) * jitter;
    out[i * 3 + 1] = a[1] + (b[1] - a[1]) * t + (Math.random() - 0.5) * jitter;
    out[i * 3 + 2] = (Math.random() - 0.5) * jitter * 2;
  }
  return out;
}

function sampleCircle(radius: number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const jitter = 0.045;
    out[i * 3] = Math.cos(a) * radius + (Math.random() - 0.5) * jitter;
    out[i * 3 + 1] = Math.sin(a) * radius + (Math.random() - 0.5) * jitter;
    out[i * 3 + 2] = (Math.random() - 0.5) * jitter * 2;
  }
  return out;
}

function targetShape(outcome: ScanOutcome): Float32Array {
  if (outcome === "accept") {
    return samplePolyline(
      [
        [[-0.62, 0.02], [-0.16, -0.44]],
        [[-0.16, -0.44], [0.66, 0.5]],
      ],
      PARTICLES,
    );
  }
  if (outcome === "reject") {
    return samplePolyline(
      [
        [[-0.5, -0.5], [0.5, 0.5]],
        [[-0.5, 0.5], [0.5, -0.5]],
      ],
      PARTICLES,
    );
  }
  return sampleCircle(0.55, PARTICLES);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function ScanResult3D({
  outcome,
  className,
}: {
  outcome: ScanOutcome;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = OUTCOME_STYLE[outcome];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 2.6);

    const group = new THREE.Group();
    scene.add(group);

    // Start positions: shell of a sphere. Targets: the verdict symbol.
    const starts = new Float32Array(PARTICLES * 3);
    for (let i = 0; i < PARTICLES; i++) {
      const v = new THREE.Vector3()
        .randomDirection()
        .multiplyScalar(1.5 + Math.random() * 0.8);
      starts.set([v.x, v.y, v.z], i * 3);
    }
    const targets = targetShape(outcome);
    const positions = new Float32Array(starts);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: style.color,
      size: 0.028,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Points(geo, mat));

    // Halo ring behind the symbol + shockwave ring that expands on assembly.
    const haloMat = new THREE.MeshBasicMaterial({
      color: style.ring,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.012, 8, 128), haloMat);
    group.add(halo);

    const waveMat = haloMat.clone();
    waveMat.opacity = 0;
    const wave = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.02, 8, 128), waveMat);
    group.add(wave);

    // Soft glow sprite in the centre.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const gctx = glowCanvas.getContext("2d")!;
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    const glowCss = `#${style.glow.toString(16).padStart(6, "0")}`;
    grad.addColorStop(0, `${glowCss}55`);
    grad.addColorStop(1, `${glowCss}00`);
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(2.4);
    group.add(glow);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const ASSEMBLE_S = 1.1;
    let raf = 0;
    const startTs = performance.now();

    const renderFrame = (now: number) => {
      const t = (now - startTs) / 1000;
      const p = easeOutCubic(Math.min(1, t / ASSEMBLE_S));

      const attr = geo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLES; i++) {
        const ix = i * 3;
        let x = starts[ix] + (targets[ix] - starts[ix]) * p;
        let y = starts[ix + 1] + (targets[ix + 1] - starts[ix + 1]) * p;
        let z = starts[ix + 2] + (targets[ix + 2] - starts[ix + 2]) * p;
        if (p >= 1) {
          // Idle behaviour after assembly: reject glitches, others breathe.
          if (outcome === "reject") {
            const glitch = Math.random() < 0.02 ? 0.08 : 0.006;
            x += (Math.random() - 0.5) * glitch;
            y += (Math.random() - 0.5) * glitch;
          } else {
            const wobble = Math.sin(t * 2 + i) * 0.004;
            x += wobble;
            y += Math.cos(t * 2 + i) * 0.004;
            z += wobble;
          }
        }
        attr.setXYZ(i, x, y, z);
      }
      attr.needsUpdate = true;

      group.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.5) * 0.16;
      halo.rotation.z = t * 0.3;
      haloMat.opacity = 0.18 + 0.12 * Math.sin(t * (outcome === "retry" ? 4 : 2));

      // Shockwave fires once as the symbol locks in.
      const wt = (t - ASSEMBLE_S) / 0.9;
      if (wt >= 0 && wt <= 1) {
        wave.scale.setScalar(1 + wt * 1.6);
        waveMat.opacity = 0.5 * (1 - wt);
      } else {
        waveMat.opacity = 0;
      }

      glowMat.opacity = p * (0.75 + 0.25 * Math.sin(t * 3));
      renderer.render(scene, camera);
    };

    if (reduceMotion) {
      renderFrame(startTs + ASSEMBLE_S * 1000 + 2000); // settled symbol, one frame
    } else {
      const loop = (now: number) => {
        renderFrame(now);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      halo.geometry.dispose();
      haloMat.dispose();
      wave.geometry.dispose();
      waveMat.dispose();
      glowTex.dispose();
      glowMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [outcome]);

  return <div ref={mountRef} className={className} aria-hidden />;
}
