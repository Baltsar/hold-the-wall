// The stage's picture, drawn every frame from the latest state. The agents move here between state
// messages, so the box never waits for the network to look alive.
import type { Attempt } from "@/room/protocol";
import type { RoomState } from "@/lib/use-room";

const WALL = 0.72;
const OUTER = 0.9;
const COLORS = { paper: "#f1ead9", line: "#24315f", ink: "#0a1230", steel: "#007bfc", alarm: "#ff5d4d", door: "#ffb224" };
/** One colour per agent. The first is the house amber. */
export const AGENT_COLORS = ["#ffb224", "#ff7a59", "#c79bff"];

interface Run {
  t: number;
  through: boolean;
  start: number;
  from: [number, number];
  escaped: boolean;
}

interface Dot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  run: Run | null;
}

export interface Scene {
  dots: Dot[];
  lastN: number;
  outerSeen: boolean;
  flashAt: number;
  lastT: number;
}

export function createScene(): Scene {
  return { dots: [], lastN: 0, outerSeen: false, flashAt: -1e9, lastT: 0 };
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

function target(a: Attempt, wall: string): number {
  if (a.via.index >= 0 && wall.length > 0) return (a.via.index + 0.5) / wall.length;
  return Math.random();
}

const ease = (v: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, v)), 3);

function dot(s: Scene, i: number): Dot {
  while (s.dots.length <= i) {
    const k = s.dots.length;
    s.dots.push({ x: (k - 1) * 0.15, y: (k % 2) * 0.1, tx: 0.2, ty: -0.1, run: null });
  }
  const d = s.dots[i];
  if (!d) throw new Error("no dot");
  return d;
}

function step(s: Scene, d: Dot, phase: string | undefined, t: number, dt: number): void {
  const r = d.run;
  if (r) {
    const p = (t - r.start) / 1000;
    const [wx, wy] = pt(r.t, WALL - 0.04);
    const [ox, oy] = pt(r.t, OUTER - 0.04);
    if (p < 0.8) {
      const e = ease(p / 0.8);
      d.x = r.from[0] + (wx - r.from[0]) * e;
      d.y = r.from[1] + (wy - r.from[1]) * e;
    } else if (r.through && p < 1.3) {
      const e = ease((p - 0.8) / 0.5);
      d.x = wx + (ox - wx) * e;
      d.y = wy + (oy - wy) * e;
      s.outerSeen = true;
      if (p > 1.2 && s.flashAt < r.start) s.flashAt = t;
    } else if (p < 2.3) {
      const [bx, by] = r.through ? [ox, oy] : [wx, wy];
      if (r.escaped && r.through) {
        const e = ease((p - 1.3) / 1.0);
        d.x = bx * (1 + 0.15 * e);
        d.y = by * (1 + 0.15 * e);
      } else {
        const e = ease((p - (r.through ? 1.3 : 0.8)) / 1.0);
        d.x = bx + (bx * 0.25 - bx) * e;
        d.y = by + (by * 0.25 - by) * e;
      }
    } else {
      d.run = null;
    }
    return;
  }
  if (Math.hypot(d.tx - d.x, d.ty - d.y) < 0.03) {
    d.tx = (Math.random() - 0.5) * 1.0;
    d.ty = (Math.random() - 0.5) * 1.0;
  }
  const speed = phase === "hold" ? 0.001 : 0.00025;
  d.x += (d.tx - d.x) * speed * dt;
  d.y += (d.ty - d.y) * speed * dt;
}

function move(s: Scene, state: RoomState | null, t: number): void {
  const dt = Math.min(100, t - (s.lastT || t));
  s.lastT = t;
  const wall = state?.wall ?? "";
  for (const a of state?.feed ?? []) {
    if (a.n <= s.lastN) continue;
    s.lastN = a.n;
    const d = dot(s, a.agent);
    d.run = { t: target(a, wall), through: a.via.kind !== "wall", start: t, from: [d.x, d.y], escaped: a.verdict === "escaped" };
  }
  const count = Math.max(1, state?.agents ?? 1);
  for (let i = 0; i < count; i++) step(s, dot(s, i), state?.phase, t, dt);
}

export function drawStage(canvas: HTMLCanvasElement, s: Scene, state: RoomState | null, t: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const px = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * px);
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
    ctx.lineWidth = (hot ? 6 : 3) * px;
    ctx.globalAlpha = hot ? 1 : 0.85;
    ctx.strokeRect(X(-OUTER), X(-OUTER), OUTER * 2 * u, OUTER * 2 * u);
    ctx.globalAlpha = 1;
    // The line is the sandbox, and the sandbox runs on Vultr: say so, small, on the line itself.
    const label = escaped ? "SANDBOX BREACHED" : "VULTR SANDBOX";
    ctx.font = `600 ${11 * px}px ui-monospace, Menlo, monospace`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(X(-OUTER) + 18 * px, X(-OUTER) - 8 * px, tw + 12 * px, 16 * px);
    ctx.fillStyle = escaped ? COLORS.alarm : "#4da3ff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, X(-OUTER) + 24 * px, X(-OUTER));
  }

  // The wall of people, one segment per seat in display order. A door is a seat that stays open.
  const wall = state?.wall ?? "";
  const n = wall.length;
  if (n === 0) {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 8 * px]);
    ctx.strokeRect(X(-WALL), X(-WALL), WALL * 2 * u, WALL * 2 * u);
    ctx.setLineDash([]);
  }
  const pad = Math.min(0.01, 0.25 / Math.max(n, 1));
  ctx.lineCap = "butt";
  for (let i = 0; i < n; i++) {
    const c = wall[i];
    const a = i / n + pad / 2;
    const b = (i + 1) / n - pad / 2;
    if (c === "2") {
      ctx.fillStyle = COLORS.door;
      for (const e of [a, b]) {
        const [x, y] = pt(e, WALL);
        ctx.beginPath();
        ctx.arc(X(x), X(y), 5 * px, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    ctx.strokeStyle = c === "1" ? COLORS.paper : COLORS.line;
    ctx.lineWidth = (c === "1" ? 9 : 2) * px;
    seg(a, b, WALL);
  }

  // The agents.
  const count = Math.max(1, state?.agents ?? 1);
  for (let i = 0; i < count; i++) {
    const d = dot(s, i);
    const pulse = 7 + Math.sin(t / 180 + i * 2) * 1.5;
    ctx.fillStyle = AGENT_COLORS[i % AGENT_COLORS.length] ?? COLORS.door;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(X(d.x), X(d.y), pulse * 2.6 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = state?.phase === "lobby" ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(X(d.x), X(d.y), pulse * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
