import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import type { Group, MeshStandardMaterial, Mesh } from "three";
import { Color } from "three";
import { GRID_H, GRID_W, HOME_BAYS, HUMAN_ZONE, LOCATIONS, RACKS, positionAt, type PathPt } from "../convex/lib/warehouse";
import { serverNow } from "./clock";

export type RobotView = {
  num: number;
  status: string;
  battery: number;
  path: number[][];
  events: { step: number; type: string }[];
};

const GREEN = new Color("#22c55e");
const BLUE = new Color("#3b82f6");
const YELLOW = new Color("#facc15");

function robotState(r: RobotView, step: number) {
  let carrying = false;
  let charging = false;
  for (const e of r.events) {
    if (e.step > step) break;
    if (e.type === "pick") carrying = true;
    if (e.type === "drop") carrying = false;
    if (e.type === "charge_start") charging = true;
    if (e.type === "charge_end") charging = false;
  }
  const last = r.path[r.path.length - 1];
  const busy = r.status === "busy" && last && step < last[2];
  return { carrying, charging, busy };
}

function Robot({ r, stepMs }: { r: RobotView; stepMs: number }) {
  const g = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const load = useRef<Mesh>(null);
  const label = useRef<HTMLDivElement>(null);
  const heading = useRef(0);
  useFrame(() => {
    const step = serverNow() / stepMs;
    const p = positionAt(r.path as PathPt[], step);
    const ahead = positionAt(r.path as PathPt[], step + 0.3);
    if (g.current) {
      g.current.position.set(p.x, 0, p.y);
      const dx = ahead.x - p.x;
      const dz = ahead.y - p.y;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) heading.current = Math.atan2(dx, dz);
      g.current.rotation.y += (heading.current - g.current.rotation.y) * 0.2;
    }
    const s = robotState(r, step);
    const c = s.charging ? YELLOW : s.busy ? BLUE : GREEN;
    const mat = body.current?.material as MeshStandardMaterial | undefined;
    if (mat) {
      mat.color.copy(c);
      mat.emissive.copy(c);
      mat.emissiveIntensity = 0.55 + 0.25 * Math.sin(performance.now() / 300);
    }
    if (load.current) load.current.visible = s.carrying;
    if (label.current) {
      label.current.style.color = s.charging ? "#facc15" : s.busy ? "#93c5fd" : "#86efac";
      label.current.textContent = `R${r.num} · ${Math.round(r.battery)}%${s.charging ? " ⚡" : ""}`;
    }
  });
  return (
    <group ref={g}>
      <RoundedBox ref={body} args={[0.8, 0.3, 0.8]} radius={0.08} position={[0, 0.2, 0]} castShadow>
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0.37, 0.28]}>
        <boxGeometry args={[0.5, 0.04, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh ref={load} position={[0, 0.58, 0]} castShadow visible={false}>
        <boxGeometry args={[0.62, 0.4, 0.62]} />
        <meshStandardMaterial color="#b45309" roughness={0.9} />
      </mesh>
      <Html position={[0, 1.15, 0]} center zIndexRange={[10, 0]}>
        <div ref={label} className="robot-label">R{r.num}</div>
      </Html>
    </group>
  );
}

function Warehouse() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[GRID_W / 2 - 0.5, 0, GRID_H / 2 - 0.5]} receiveShadow>
        <planeGeometry args={[GRID_W, GRID_H]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <gridHelper args={[GRID_W, GRID_W, "#1f2937", "#1f2937"]} position={[GRID_W / 2 - 0.5, 0.005, GRID_H / 2 - 0.5]} />
      {/* human zone */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(HUMAN_ZONE.x0 + HUMAN_ZONE.x1) / 2, 0.01, (HUMAN_ZONE.y0 + HUMAN_ZONE.y1) / 2]}
      >
        <planeGeometry args={[HUMAN_ZONE.x1 - HUMAN_ZONE.x0 + 1, HUMAN_ZONE.y1 - HUMAN_ZONE.y0 + 1]} />
        <meshStandardMaterial color="#dc2626" transparent opacity={0.35} emissive="#7f1d1d" />
      </mesh>
      <Html position={[(HUMAN_ZONE.x0 + HUMAN_ZONE.x1) / 2, 0.3, (HUMAN_ZONE.y0 + HUMAN_ZONE.y1) / 2]} center zIndexRange={[5, 0]}>
        <div className="place-label" style={{ color: "#fca5a5" }}>⚠ Human zone</div>
      </Html>
      {RACKS.map((r) => (
        <group key={r.name}>
          <mesh position={[(r.x0 + r.x1) / 2, 0.6, r.y]} castShadow>
            <boxGeometry args={[r.x1 - r.x0 + 0.9, 1.2, 0.8]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          <Html position={[(r.x0 + r.x1) / 2, 1.5, r.y]} center zIndexRange={[5, 0]}>
            <div className="place-label">{r.name}</div>
          </Html>
        </group>
      ))}
      {LOCATIONS.filter((l) => l.kind === "dock").map((l) => (
        <group key={l.name}>
          <mesh position={[0, 0.4, l.access.y]}>
            <boxGeometry args={[0.9, 0.8, 1.6]} />
            <meshStandardMaterial color="#0e7490" emissive="#083344" />
          </mesh>
          <Html position={[0, 1.1, l.access.y]} center zIndexRange={[5, 0]}>
            <div className="place-label" style={{ color: "#67e8f9" }}>{l.name}</div>
          </Html>
        </group>
      ))}
      {LOCATIONS.filter((l) => l.kind === "charger").map((l) => (
        <group key={l.name}>
          <mesh position={[l.access.x + 1, 0.5, l.access.y]}>
            <boxGeometry args={[0.6, 1, 0.9]} />
            <meshStandardMaterial color="#ca8a04" emissive="#713f12" />
          </mesh>
          <Html position={[l.access.x + 1, 1.3, l.access.y]} center zIndexRange={[5, 0]}>
            <div className="place-label" style={{ color: "#fde047" }}>⚡ Charger</div>
          </Html>
        </group>
      ))}
      {HOME_BAYS.map((h, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[h.x, 0.012, h.y]}>
          <ringGeometry args={[0.38, 0.45, 4, 1, Math.PI / 4]} />
          <meshBasicMaterial color="#475569" />
        </mesh>
      ))}
    </>
  );
}

export function Sim({ robots, stepMs }: { robots: RobotView[]; stepMs: number }) {
  return (
    <Canvas shadows camera={{ position: [GRID_W / 2, 17, GRID_H + 9], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={["#07090f"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 20, 8]} intensity={1.1} castShadow />
      <Warehouse />
      {robots.map((r) => (
        <Robot key={r.num} r={r} stepMs={stepMs} />
      ))}
      <OrbitControls target={[GRID_W / 2 - 0.5, 0, GRID_H / 2 - 0.5]} maxPolarAngle={Math.PI / 2.2} />
    </Canvas>
  );
}
