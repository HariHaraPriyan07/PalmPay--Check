"use client";

// Holographic palm point-cloud (Theme v2). A procedurally generated hand made
// of ~2600 glowing points, slowly rotating inside two gyroscope rings while a
// scan plane sweeps across it and lights up nearby points. Pure three.js —
// no react-three-fiber — so it stays a small, disposable canvas.

import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Procedural hand: palm disc + 5 fingers, in the XY plane with a slight dome. */
function buildHandPoints(count = 2600): Float32Array {
  const pts: number[] = [];

  // Region sampling helpers — every accepted sample gets dome-curvature z + jitter.
  const push = (x: number, y: number) => {
    const r2 = x * x + y * y;
    const z = 0.16 * Math.max(0, 1 - r2 * 0.9) + (Math.random() - 0.5) * 0.05;
    pts.push(x + (Math.random() - 0.5) * 0.015, y + (Math.random() - 0.5) * 0.015, z);
  };

  // Palm: superellipse-ish blob centred slightly below origin.
  const palmTarget = Math.floor(count * 0.48);
  let placed = 0;
  while (placed < palmTarget) {
    const x = (Math.random() * 2 - 1) * 0.62;
    const y = (Math.random() * 2 - 1) * 0.62 - 0.28;
    const nx = x / 0.6;
    const ny = (y + 0.28) / 0.58;
    if (nx * nx * nx * nx + ny * ny * ny * ny <= 1) {
      push(x, y);
      placed++;
    }
  }

  // Four fingers: capsules rising from the palm top edge.
  const fingers: Array<{ x: number; len: number; tilt: number }> = [
    { x: -0.44, len: 0.5, tilt: -0.12 }, // pinky
    { x: -0.16, len: 0.68, tilt: -0.04 }, // ring
    { x: 0.12, len: 0.74, tilt: 0.02 }, // middle
    { x: 0.4, len: 0.6, tilt: 0.1 }, // index
  ];
  const perFinger = Math.floor((count * 0.42) / 4);
  for (const f of fingers) {
    for (let i = 0; i < perFinger; i++) {
      const t = Math.random();
      const width = 0.085 * (1 - t * 0.35);
      const x = f.x + f.tilt * t + (Math.random() * 2 - 1) * width;
      const y = 0.26 + t * f.len;
      push(x, y);
    }
  }

  // Thumb: angled capsule off the palm's side.
  const thumbCount = count - palmTarget - perFinger * 4;
  for (let i = 0; i < thumbCount; i++) {
    const t = Math.random();
    const width = 0.09 * (1 - t * 0.3);
    const x = 0.52 + t * 0.42 + (Math.random() * 2 - 1) * width;
    const y = -0.5 + t * 0.5 + (Math.random() * 2 - 1) * width;
    push(x, y);
  }

  return new Float32Array(pts);
}

export function PalmHologram({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 0, 3.4);

    const group = new THREE.Group();
    scene.add(group);

    // Hand point cloud with per-vertex colors (scan-line brightening).
    const positions = buildHandPoints();
    const n = positions.length / 3;
    const colors = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cloud = new THREE.Points(geo, mat);
    cloud.position.y = -0.12;
    group.add(cloud);

    // Gyroscope rings around the hand.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.006, 8, 120), ringMat);
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.32, 0.004, 8, 120),
      ringMat.clone(),
    );
    (ring2.material as THREE.MeshBasicMaterial).color.set(0xa78bfa);
    ring1.rotation.x = Math.PI / 2.4;
    ring2.rotation.x = Math.PI / 1.9;
    ring2.rotation.y = 0.5;
    group.add(ring1, ring2);

    // Scan plane: a thin glowing bar sweeping vertically over the hand.
    const scanGeo = new THREE.PlaneGeometry(2.2, 0.014);
    const scanMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const scan = new THREE.Mesh(scanGeo, scanMat);
    group.add(scan);

    const base = new THREE.Color(0x0e7490); // dim cyan
    const hot = new THREE.Color(0x9df6ff); // scan-line highlight

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

    let raf = 0;
    const start = performance.now();
    const tmp = new THREE.Color();

    const renderFrame = (now: number) => {
      const t = (now - start) / 1000;
      group.rotation.y = reduceMotion ? 0.25 : Math.sin(t * 0.35) * 0.55;
      group.rotation.x = reduceMotion ? -0.1 : Math.sin(t * 0.22) * 0.12 - 0.08;
      ring1.rotation.z = t * 0.25;
      ring2.rotation.z = -t * 0.18;

      // Scan line sweeps -0.9 .. 1.1 (hand spans roughly -0.9..1.0 in y).
      const scanY = reduceMotion ? 0.2 : -0.9 + ((t * 0.45) % 2) * 1.0;
      scan.position.y = scanY - 0.12;
      scanMat.opacity = 0.5 + 0.35 * Math.sin(t * 6);

      // Brighten points near the scan plane.
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      const col = geo.getAttribute("color") as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        const dy = Math.abs(pos.getY(i) - scanY);
        const glow = Math.max(0, 1 - dy * 7);
        tmp.copy(base).lerp(hot, glow * glow);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      col.needsUpdate = true;

      renderer.render(scene, camera);
    };

    if (reduceMotion) {
      renderFrame(start); // single static frame
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
      ring1.geometry.dispose();
      ring2.geometry.dispose();
      ringMat.dispose();
      (ring2.material as THREE.Material).dispose();
      scanGeo.dispose();
      scanMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className={className} aria-hidden />;
}
