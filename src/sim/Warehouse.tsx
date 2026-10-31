import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Mesh, Group } from "three";
import { CHARGER_BAYS, DOCKS, H, HOMES, HUMAN_ZONE, RACKS, W } from "../../shared/layout";
import type { Waypoint } from "../../shared/types";

export type RobotView = { num: number; path: Waypoint[]; cell: { x: number; y: number }; battery: number; busyUntil: number };

function Label({ text, position, color = "#e2e8f0", bg = "rgba(0,0,0,0.55)", scale = 0.5 }: { text: string; position: [number, number, number]; color?: string; bg?: string; scale?: number }) {
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 48px system-ui, sans-serif";
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    c.width = w;
    c.height = 64;
    ctx.font = "bold 48px system-ui, sans-serif";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, 64);
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 12, 34);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return { tex: t, aspect: w / 64 };
  }, [text, color, bg]);
  return (
    <sprite position={position} scale={[scale * aspect, scale, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

// grid (x, y) -> world (x, z), centered
const wx = (x: number) => x - W / 2 + 0.5;
const wz = (y: number) => y - H / 2 + 0.5;

function sample(r: RobotView, now: number) {
  const p = r.path;
  if (!p.length || now >= p[p.length - 1].t) return { x: r.cell.x, y: r.cell.y, a: "idle", c: false, busy: now < r.busyUntil };
  if (now <= p[0].t) return { x: p[0].x, y: p[0].y, a: p[0].a ?? "move", c: !!p[0].c, busy: true };
  let lo = 0,
    hi = p.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p[m].t <= now) lo = m;
    else hi = m;
  }
  const a = p[lo],
    b = p[hi];
  const f = (now - a.t) / Math.max(1, b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, a: b.a ?? "move", c: !!a.c, busy: true };
}

function Robot({ r, offset }: { r: RobotView; offset: () => number }) {
  const g = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const load = useRef<Group>(null);
  useFrame(() => {
    const s = sample(r, Date.now() + offset());
    if (g.current) g.current.position.set(wx(s.x), 0, wz(s.y));
    const color = s.a === "charge" ? "#facc15" : s.busy ? "#3b82f6" : "#22c55e";
    const m = body.current?.material as unknown as { color: { set(c: string): void }; emissive: { set(c: string): void } } | undefined;
    m?.color.set(color);
    m?.emissive.set(color);
    if (load.current) load.current.visible = s.c;
  });
  return (
    <group ref={g}>
      <mesh ref={body} position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.75, 0.3, 0.75]} />
        <meshStandardMaterial emissiveIntensity={0.6} />
      </mesh>
      <group ref={load} position={[0, 0.58, 0]} visible={false}>
        <mesh scale={[1, 0.78, 1]} castShadow>
          <sphereGeometry args={[0.3, 20, 14]} />
          <meshStandardMaterial color="#f97316" emissive="#c2410c" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 0.27, 0]}>
          <cylinderGeometry args={[0.04, 0.05, 0.14, 8]} />
          <meshStandardMaterial color="#166534" />
        </mesh>
      </group>
      <Label text={`R${r.num}`} position={[0, 1.0, 0]} scale={0.45} />
    </group>
  );
}

function Tile({ x, y, color, h = 0.02, label, opacity = 1 }: { x: number; y: number; color: string; h?: number; label?: string; opacity?: number }) {
  return (
    <group position={[wx(x), h / 2, wz(y)]}>
      <mesh receiveShadow>
        <boxGeometry args={[0.96, h, 0.96]} />
        <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      {label && <Label text={label} position={[0, h / 2 + 0.45, 0]} scale={0.38} />}
    </group>
  );
}

function JackOLantern({ x, y }: { x: number; y: number }) {
  const light = useRef<{ intensity: number } | null>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = 1.6 + Math.sin(clock.elapsedTime * 7 + x) * 0.4 + Math.sin(clock.elapsedTime * 13 + y) * 0.25;
  });
  return (
    <group position={[wx(x), 0.32, wz(y)]}>
      <mesh scale={[1, 0.8, 1]}>
        <sphereGeometry args={[0.4, 20, 14]} />
        <meshStandardMaterial color="#ea580c" emissive="#f59e0b" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.18, 8]} />
        <meshStandardMaterial color="#14532d" />
      </mesh>
      <pointLight ref={light as never} color="#fb923c" distance={6} intensity={1.6} position={[0, 0.6, 0]} />
    </group>
  );
}

export function Warehouse({ robots, offset }: { robots: RobotView[]; offset: () => number }) {
  const zone = [];
  for (let x = HUMAN_ZONE.x0; x <= HUMAN_ZONE.x1; x++) for (let y = HUMAN_ZONE.y0; y <= HUMAN_ZONE.y1; y++) zone.push({ x, y });
  return (
    <Canvas shadows camera={{ position: [0, 15, 11], fov: 45 }}>
      <color attach="background" args={["#12051f"]} />
      <fog attach="fog" args={["#12051f", 22, 42]} />
      <ambientLight intensity={0.45} color="#c4b5fd" />
      <directionalLight position={[6, 12, 6]} intensity={0.9} color="#e9d5ff" castShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color="#1e1030" />
      </mesh>
      <gridHelper args={[W, W, "#4c1d95", "#3b0764"]} position={[0, 0.005, 0]} scale={[1, 1, H / W]} />
      {DOCKS.map((d) => (
        <Tile key={d.name} x={d.access.x} y={d.access.y} color="#f97316" label={`🎃 ${d.name}`} />
      ))}
      {RACKS.map((r) => (
        <group key={r.name}>
          {r.body.map((c, i) => (
            <Tile key={i} x={c.x} y={c.y} color="#581c87" h={1.2} label={i === 0 ? r.name : undefined} />
          ))}
          <Tile x={r.access.x} y={r.access.y} color="#6b21a8" />
        </group>
      ))}
      {zone.map((c, i) => (
        <Tile key={i} x={c.x} y={c.y} color="#ef4444" opacity={0.45} label={i === 5 ? "HUMAN ZONE" : undefined} />
      ))}
      {CHARGER_BAYS.map((c, i) => (
        <Tile key={i} x={c.x} y={c.y} color="#ca8a04" label={i === 1 ? "Charging" : undefined} />
      ))}
      {HOMES.map((c, i) => (
        <Tile key={i} x={c.x} y={c.y} color="#14532d" />
      ))}
      {[[0, 0], [19, 0], [0, 11], [8, 6], [12, 10]].map(([x, y]) => (
        <JackOLantern key={`${x},${y}`} x={x} y={y} />
      ))}
      {robots.map((r) => (
        <Robot key={r.num} r={r} offset={offset} />
      ))}
      <OrbitControls enablePan={false} maxPolarAngle={1.3} minDistance={8} maxDistance={30} />
    </Canvas>
  );
}
