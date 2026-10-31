import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, DoubleSide, Vector3, type Group, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";
import { sheetOpacity, trailAlpha } from "./ghostFx";

// Halloween "car cover" sheet draped over a robot. Purely visual: a procedural
// boxy dome with static folds; the hem trails and ripples while the robot drives.
const SEG = 72; // around
const RINGS = 13; // top -> hem
const SHOULDER_V = 0.38;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function buildSheet(seed: number) {
  const n = SEG * RINGS;
  const base = new Float32Array(n * 3);
  const meta = new Float32Array(n * 4); // v, theta, outward x, outward z
  for (let i = 0; i < RINGS; i++) {
    const v = i / (RINGS - 1);
    const u = Math.min(v / SHOULDER_V, 1);
    // half-size and height of this ring: rounded cap, then a slightly flared skirt
    const r = v < SHOULDER_V ? 0.47 * Math.sin((u * Math.PI) / 2) : 0.47 + ((v - SHOULDER_V) / (1 - SHOULDER_V)) * 0.09;
    const y = v < SHOULDER_V ? 0.48 - 0.1 * (1 - Math.cos((u * Math.PI) / 2)) : 0.38 - ((v - SHOULDER_V) / (1 - SHOULDER_V)) * 0.27;
    const fold = 0.055 * Math.pow(smooth(0.25, 1, v), 1.3);
    for (let j = 0; j < SEG; j++) {
      const th = (j / SEG) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const k = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25); // superellipse: boxy like the robot
      const wave = 0.6 * Math.sin(th * 7 + seed) + 0.4 * Math.sin(th * 13 + seed * 2.3);
      const rr = r * k + fold * wave;
      const idx = i * SEG + j;
      base[idx * 3] = rr * c;
      base[idx * 3 + 1] = y + 0.03 * Math.pow(v, 4) * wave; // uneven hem
      base[idx * 3 + 2] = rr * s;
      meta.set([v, th, c, s], idx * 4);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < RINGS - 1; i++)
    for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      const c2 = a + SEG;
      const d = b + SEG;
      index.push(a, b, c2, b, d, c2); // outward-facing winding
    }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(base.slice(), 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, base, meta };
}

export function GhostSheet({ seed = 0, battery = 100 }: { seed?: number; battery?: number }) {
  const { geo, base, meta } = useMemo(() => buildSheet(seed), [seed]);
  const mesh = useRef<Mesh>(null);
  const glow = useRef<Mesh>(null);
  const prev = useRef<Vector3 | null>(null);
  const speed = useRef(0);
  const applied = useRef(0);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m || dt <= 0) return;
    // low battery: the ghost gently fades (with a faint shimmer) - visual only
    const op = sheetOpacity(battery);
    const shimmer = op < 1 ? 0.04 * Math.sin(state.clock.elapsedTime * 3 + seed) : 0;
    (m.material as MeshStandardMaterial).opacity = Math.min(1, op + shimmer);
    if (glow.current) (glow.current.material as MeshBasicMaterial).opacity = 0.16 * op;
    m.getWorldPosition(tmp);
    const moved = prev.current ? tmp.distanceTo(prev.current) / dt : 0;
    (prev.current ??= new Vector3()).copy(tmp);
    // smoothed speed in cells/s, normalised so ~2 cells/s = full flutter
    speed.current += (Math.min(moved / 2, 1) - speed.current) * Math.min(1, dt * 4);
    const w = speed.current < 0.02 ? 0 : speed.current;
    if (w === 0 && applied.current === 0) return; // parked: keep the static drape, no per-frame work
    applied.current = w;

    const t = state.clock.elapsedTime;
    const pos = geo.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let idx = 0; idx < SEG * RINGS; idx++) {
      const v = meta[idx * 4];
      if (v < SHOULDER_V) continue;
      const th = meta[idx * 4 + 1];
      const ox = meta[idx * 4 + 2];
      const oz = meta[idx * 4 + 3];
      const h = (v - SHOULDER_V) / (1 - SHOULDER_V); // 0 at shoulder, 1 at hem
      const h2 = h * h;
      const back = Math.max(0, -oz); // trailing side (robot faces local +z)
      const ripple = Math.sin(th * 5 - t * 9 + seed) * 0.022 * h2 * w;
      arr[idx * 3] = base[idx * 3] + ox * ripple;
      arr[idx * 3 + 1] = base[idx * 3 + 1] + (0.015 * back + 0.005) * h2 * w + Math.sin(th * 3 + t * 7) * 0.006 * h2 * w;
      arr[idx * 3 + 2] = base[idx * 3 + 2] + oz * ripple - (0.06 + 0.06 * back) * h2 * w;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });

  return (
    <group>
      <mesh ref={mesh} geometry={geo} castShadow>
        <meshStandardMaterial color="#eef2f7" emissive="#cfe0ff" emissiveIntensity={0.12} roughness={0.75} side={DoubleSide} transparent />
      </mesh>
      {/* soft blue-white rim glow: slightly larger back-face shell, additive */}
      <mesh ref={glow} geometry={geo} scale={1.05}>
        <meshBasicMaterial color="#bfdbfe" transparent opacity={0.16} side={BackSide} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Soft afterimages left behind a moving ghost. Lives in world space (not inside the
// robot group) and samples the robot's past poses; invisible while parked.
const TRAIL_N = 4;
const SAMPLE_S = 0.1;
const SPACING = 3; // samples between afterimages (~0.3 s apart)

export function GhostTrail({ target, seed = 0 }: { target: RefObject<Group | null>; seed?: number }) {
  const geo = useMemo(() => buildSheet(seed).geo, [seed]);
  const meshes = useRef<(Mesh | null)[]>([]);
  const hist = useRef<{ x: number; z: number; ry: number }[]>([]);
  const acc = useRef(0);
  const speed = useRef(0);
  const last = useRef<{ x: number; z: number } | null>(null);

  useFrame((_, dt) => {
    const g = target.current;
    if (!g || dt <= 0) return;
    const { x, z } = g.position;
    const moved = last.current ? Math.hypot(x - last.current.x, z - last.current.z) / dt : 0;
    last.current = { x, z };
    speed.current += (Math.min(moved / 2, 1) - speed.current) * Math.min(1, dt * 4);
    acc.current += dt;
    if (acc.current >= SAMPLE_S) {
      acc.current = 0;
      hist.current.unshift({ x, z, ry: g.rotation.y });
      hist.current.length = Math.min(hist.current.length, TRAIL_N * SPACING + 1);
    }
    for (let i = 0; i < TRAIL_N; i++) {
      const m = meshes.current[i];
      const h = hist.current[(i + 1) * SPACING];
      if (!m) continue;
      const a = h ? trailAlpha(i, TRAIL_N, speed.current < 0.05 ? 0 : speed.current) : 0;
      m.visible = a > 0.005;
      if (!m.visible || !h) continue;
      m.position.set(h.x, 0.02 * i, h.z);
      m.rotation.y = h.ry;
      (m.material as MeshBasicMaterial).opacity = a;
    }
  });

  return (
    <>
      {Array.from({ length: TRAIL_N }, (_, i) => (
        <mesh key={i} ref={(el) => void (meshes.current[i] = el)} geometry={geo} scale={1 - i * 0.04} visible={false}>
          <meshBasicMaterial color="#dbeafe" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
