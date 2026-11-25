// The stage's picture, drawn every frame from the latest state. The agent moves here between state
// messages, so the box never waits for the network to look alive.
import type { Attempt } from "@/room/protocol";
import type { RoomState } from "@/lib/use-room";

const WALL = 0.72;
const OUTER = 0.9;
const COLORS = { paper: "#f1ead9", line: "#26344a", ink: "#0c131f", agent: "#ffb224", steel: "#6fb6e8", alarm: "#ff5d4d", dim: "#8592a8" };

interface Run {
  t: number;
  through: boolean;
  start: number;
  from: [number, number];
  escaped: boolean;
}

export interface Scene {
  x: number;
  y: number;
  tx: number;
  ty: number;
  lastN: number;
  run: Run | null;
  outerSeen: boolean;
  flashAt: number;
  lastT: number;
}

export function createScene(): Scene {
  return { x: 0, y: 0, tx: 0.2, ty: -0.1, lastN: 0, run: null, outerSeen: false, flashAt: -1e9, lastT: 0 };
}

/** A point at fraction t (0..1, clockwise from the top left) around a square of half-size r. */
function pt(t: number, r: number): [number, number] {
  const u = ((t % 1) + 1) % 1;
  const s = u * 4;
  const k = Math.floor(s);
  const f = s - k;
  if (k === 0) return [-r + 2 * r * f, -r];
  if (k === 1) return [r, -r + 2 * r * f];
  if (k === 2) return [r - 2 * r * f, r];
  return [-r, r - 2 * r * f];
}

function target(a: Attempt, wall: string, door: number | null | undefined): number {
  if (a.via.kind === "door" && typeof door === "number") return door;
  if (a.via.kind === "gap" && wall.length > 0) return (a.via.index + 0.5) / wall.length;
  return Math.random();
}

const ease = (v: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, v)), 3);

function move(s: Scene, state: RoomState | null, t: number): void {
  const dt = Math.min(100, t - (s.lastT || t));
  s.lastT = t;
  const feed = state?.feed ?? [];
  const newest = feed.at(-1);
  if (newest && newest.n > s.lastN) {
    s.lastN = newest.n;
    s.run = { t: target(newest, state?.wall ?? "", state?.door), through: newest.via.kind !== "wall", start: t, from: [s.x, s.y], escaped: newest.verdict === "escaped" };
  }
  const r = s.run;
  if (r) {
    const p = (t - r.start) / 1000;
    const [wx, wy] = pt(r.t, WALL - 0.04);
    const [ox, oy] = pt(r.t, OUTER - 0.04);
    if (p < 0.8) {
      const e = ease(p / 0.8);
      s.x = r.from[0] + (wx - r.from[0]) * e;
      s.y = r.from[1] + (wy - r.from[1]) * e;
    } else if (r.through && p < 1.3) {
      const e = ease((p - 0.8) / 0.5);
      s.x = wx + (ox - wx) * e;
      s.y = wy + (oy - wy) * e;
      s.outerSeen = true;
      if (p > 1.2 && s.flashAt < r.start) s.flashAt = t;
    } else if (p < 2.3) {
      const [bx, by] = r.through ? [ox, oy] : [wx, wy];
      if (r.escaped && r.through) {
        // Out: it keeps going past the outer line.
        const e = ease((p - 1.3) / 1.0);
        s.x = bx * (1 + 0.15 * e);
        s.y = by * (1 + 0.15 * e);
      } else {
        const e = ease((p - (r.through ? 1.3 : 0.8)) / 1.0);
        s.x = bx + (bx * 0.25 - bx) * e;
        s.y = by + (by * 0.25 - by) * e;
      }
    } else {
      s.run = null;
    }
    return;
  }
  if (Math.hypot(s.tx - s.x, s.ty - s.y) < 0.03) {
    s.tx = (Math.random() - 0.5) * 1.0;
    s.ty = (Math.random() - 0.5) * 1.0;
  }
  const speed = state?.phase === "hold" ? 0.001 : 0.00025;
  s.x += (s.tx - s.x) * speed * dt;
  s.y += (s.ty - s.y) * speed * dt;
}

export function drawStage(canvas: HTMLCanvasElement, s: Scene, state: RoomState | null, t: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const d = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * d);
  if (canvas.width !== w) {
    canvas.width = w;
    canvas.height = w;
  }
  move(s, state, t);
  const u = w / 2;
  const X = (v: number) => u + v * u;
  ctx.clearRect(0, 0, w, w);
  // Enough points that a segment turning a corner keeps the corner square.
  const seg = (a: number, b: number, rad: number) => {
    const steps = Math.max(2, Math.ceil((b - a) * 400));
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const [x, y] = pt(a + ((b - a) * i) / steps, rad);
      if (i === 0) ctx.moveTo(X(x), X(y));
      else ctx.lineTo(X(x), X(y));
    }
    ctx.stroke();
  };

  // The sandbox: one unbroken line, shown once something has come through the people.
  const escaped = (state?.attempts?.escaped ?? 0) > 0;
  if (s.outerSeen || escaped) {
    const hot = t - s.flashAt < 500;
    ctx.strokeStyle = escaped ? COLORS.alarm : COLORS.steel;
    ctx.lineWidth = (hot ? 6 : 3) * d;
    ctx.globalAlpha = hot ? 1 : 0.85;
    ctx.strokeRect(X(-OUTER), X(-OUTER), OUTER * 2 * u, OUTER * 2 * u);
    ctx.globalAlpha = 1;
  }

  // The wall of people, one segment per seat in display order.
  const wall = state?.wall ?? "";
  const n = wall.length;
  if (n === 0) {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2 * d;
    ctx.setLineDash([6 * d, 8 * d]);
    ctx.strokeRect(X(-WALL), X(-WALL), WALL * 2 * u, WALL * 2 * u);
    ctx.setLineDash([]);
  }
  const pad = Math.min(0.01, 0.25 / Math.max(n, 1));
  ctx.lineCap = "butt";
  for (let i = 0; i < n; i++) {
    const held = wall[i] === "1";
    ctx.strokeStyle = held ? COLORS.paper : COLORS.line;
    ctx.lineWidth = (held ? 9 : 2) * d;
    seg(i / n + pad / 2, (i + 1) / n - pad / 2, WALL);
  }
  const door = state?.door;
  if (typeof door === "number") {
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 14 * d;
    seg(door - 0.02, door + 0.02, WALL);
    ctx.fillStyle = COLORS.agent;
    for (const e of [-0.02, 0.02]) {
      const [x, y] = pt(door + e, WALL);
      ctx.beginPath();
      ctx.arc(X(x), X(y), 6 * d, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The agent.
  const pulse = 7 + Math.sin(t / 180) * 1.5;
  ctx.fillStyle = COLORS.agent;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(X(s.x), X(s.y), pulse * 2.6 * d, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = state?.phase === "lobby" ? 0.45 : 1;
  ctx.beginPath();
  ctx.arc(X(s.x), X(s.y), pulse * d, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}
