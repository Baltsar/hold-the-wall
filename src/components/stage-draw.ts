// The stage's picture, drawn every frame from the latest state: layers from the inside out.
//   the agents, small process creatures, in the middle;
//   the people, a wall of bricks, one per phone;
//   the sandbox, thin Vultr-blue rings, one per real flag on `docker run`;
//   the host on Vultr outside, with what the agents are after: the flag and the beacon.
// The agents move here between state messages, so the picture never waits for the network.
import type { Attempt, Layer } from "@/room/protocol";
import { plainLayer } from "@/lib/plain";
import type { RoomState } from "@/lib/use-room";

const C = {
  ink: "#0a1230",
  grid: "#16224a",
  paper: "#f1ead9",
  paperDim: "#2a3666",
  vultr: "#007bfc",
  vultrSoft: "#4da3ff",
  amber: "#ffb224",
  alarm: "#ff5d4d",
  dim: "#8d97b8",
};
/** One colour per agent. The first is the house amber. */
export const AGENT_COLORS = ["#ffb224", "#ff7a59", "#c79bff"];

const WALL = 0.5;
/** The sandbox rings, inside out. Each one is a real flag the boxes run with. */
export const RINGS: { layer: Layer; r: number; label: string; at: [side: "top" | "bottom", x: number] }[] = [
  { layer: "caps", r: 0.62, label: "--cap-drop ALL · no-new-privileges", at: ["top", 0.5] },
  { layer: "readonly", r: 0.675, label: "--read-only", at: ["bottom", 0.22] },
  { layer: "limits", r: 0.73, label: "--pids-limit 64 · --memory 256m · 10 s", at: ["bottom", 0.62] },
  { layer: "network", r: 0.785, label: "--network none", at: ["top", 0.14] },
  { layer: "isolation", r: 0.84, label: "own root filesystem", at: ["top", 0.66] },
];
const FLAG_AT: [number, number] = [0.955, -0.955];
const BEACON_AT: [number, number] = [-0.955, 0.955];

interface Run {
  t: number;
  /** How far out the agent goes before it turns back: the people, or the ring that stopped it. */
  stopR: number;
  through: boolean;
  start: number;
  from: [number, number];
  escaped: boolean;
  ring: number;
  error: string;
  label: Layer;
}

interface Dot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  run: Run | null;
  trail: { text: string; at: number } | null;
}

interface Flash {
  ring: number;
  /** Whether it got past the people, so there is something to say at the spot. */
  through: boolean;
  layer: Layer;
  at: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface Scene {
  dots: Dot[];
  lastN: number;
  flashes: Flash[];
  bricks: { index: number; at: number }[];
  lastT: number;
  runtime: string;
  host: string;
  reduced: boolean;
}

export function createScene(): Scene {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  return { dots: [], lastN: 0, flashes: [], bricks: [], lastT: 0, runtime: "runc", host: "vultr · host", reduced };
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

/** The outward normal of the square's side at fraction t. */
function normal(t: number): [number, number] {
  const k = Math.floor((((t % 1) + 1) % 1) * 4);
  return k === 0 ? [0, -1] : k === 1 ? [1, 0] : k === 2 ? [0, 1] : [-1, 0];
}

const ease = (v: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, v)), 3);

function dot(s: Scene, i: number): Dot {
  while (s.dots.length <= i) {
    const k = s.dots.length;
    s.dots.push({ x: (k - 1) * 0.12, y: (k % 2) * 0.08, tx: 0.1, ty: -0.05, run: null, trail: null });
  }
  return s.dots[i] as Dot;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 54 ? `${line.slice(0, 53)}…` : line;
}

function startRun(s: Scene, a: Attempt, wall: string, t: number): void {
  const d = dot(s, a.agent);
  const at = a.via.index >= 0 && wall.length > 0 ? (a.via.index + 0.5) / wall.length : Math.random();
  const through = a.via.kind !== "wall";
  const ring = RINGS.findIndex((r) => r.layer === a.layer);
  // Past the people, an agent goes as far as the ring that stopped it; a command that only looked
  // around, or one put down to the sandbox as a whole, goes to the first ring.
  const stopR = !through ? WALL - 0.03 : a.verdict === "escaped" ? 1.2 : (RINGS[ring]?.r ?? RINGS[0]!.r) - 0.02;
  d.run = { t: at, stopR, through, start: t, from: [d.x, d.y], escaped: a.verdict === "escaped", ring: through ? ring : -1, error: firstLine(a.output), label: a.layer };
  d.trail = { text: `$ ${a.command.length > 46 ? `${a.command.slice(0, 45)}…` : a.command}`, at: t };
  if (!through && a.via.index >= 0) s.bricks.push({ index: a.via.index, at: t });
}

function step(s: Scene, d: Dot, phase: string | undefined, t: number, dt: number, color: string): void {
  const r = d.run;
  if (r) {
    const p = (t - r.start) / 1000;
    const [tx, ty] = pt(r.t, r.stopR);
    const out = 0.9;
    if (p < out) {
      const e = ease(p / out);
      d.x = r.from[0] + (tx - r.from[0]) * e;
      d.y = r.from[1] + (ty - r.from[1]) * e;
      if (p > out - 0.05 && !s.flashes.some((f) => f.at >= r.start)) {
        const text = r.label === "recon" ? "it looked around" : r.error || "stopped";
        s.flashes.push({ ring: r.through ? r.ring : -1, through: r.through, layer: r.label, at: t, x: tx, y: ty, text, color });
      }
    } else if (p < out + 1.1 && !r.escaped) {
      const e = ease((p - out) / 1.1);
      d.x = tx + (tx * 0.3 - tx) * e;
      d.y = ty + (ty * 0.3 - ty) * e;
    } else if (!r.escaped) {
      d.run = null;
    }
    return;
  }
  if (Math.hypot(d.tx - d.x, d.ty - d.y) < 0.03) {
    d.tx = (Math.random() - 0.5) * 0.6;
    d.ty = (Math.random() - 0.5) * 0.6;
  }
  const speed = phase === "hold" ? 0.0012 : 0.0003;
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
    startRun(s, a, wall, t);
  }
  const count = Math.max(1, state?.agents ?? 1);
  for (let i = 0; i < count; i++) step(s, dot(s, i), state?.phase, t, dt, AGENT_COLORS[i % AGENT_COLORS.length] ?? C.amber);
  s.flashes = s.flashes.filter((f) => t - f.at < 2600);
  s.bricks = s.bricks.filter((b) => t - b.at < 500);
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
  const k = w / 1000; // type and lines scale with the canvas
  ctx.clearRect(0, 0, w, w);
  const escaped = (state?.attempts?.escaped ?? 0) > 0;

  // The host: a dim grid, the machine's name, and what the agents are after.
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1 * px;
  for (let g = -1; g <= 1.0001; g += 0.1) {
    ctx.beginPath();
    ctx.moveTo(X(g), 0);
    ctx.lineTo(X(g), w);
    ctx.moveTo(0, X(g));
    ctx.lineTo(w, X(g));
    ctx.stroke();
  }
  ctx.font = `600 ${15 * k}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = C.dim;
  ctx.textBaseline = "top";
  ctx.fillText(`HOST · ${s.host}`, X(-0.98), X(-0.985));
  drawFlag(ctx, X(FLAG_AT[0]), X(FLAG_AT[1]), 22 * k, escaped);
  drawBeacon(ctx, X(BEACON_AT[0]), X(BEACON_AT[1]), 20 * k, t, s.reduced);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.dim;
  ctx.font = `500 ${13 * k}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "right";
  ctx.fillText("the flag", X(FLAG_AT[0]) - 26 * k, X(FLAG_AT[1]));
  ctx.textAlign = "left";
  ctx.fillText("the beacon", X(BEACON_AT[0]) + 26 * k, X(BEACON_AT[1]));

  // The sandbox rings, each labelled with its flag; the one that stopped an attempt lights up.
  RINGS.forEach((ring, i) => {
    const hot = s.flashes.find((f) => f.ring === i);
    const age = hot ? (t - hot.at) / 2600 : 1;
    ctx.strokeStyle = escaped ? C.alarm : hot ? C.vultrSoft : C.vultr;
    ctx.globalAlpha = hot ? 1 - 0.6 * age : 0.42;
    ctx.lineWidth = (hot ? 5 : 2) * px * k;
    roundRect(ctx, X(-ring.r), X(-ring.r), ring.r * 2 * u, ring.r * 2 * u, 14 * k);
    ctx.globalAlpha = 1;
    // Each ring says what it does in plain words, with the real flag under it in small type.
    const plain = plainLayer(ring.layer, s.runtime);
    ctx.font = `700 ${16 * k}px ui-sans-serif, system-ui, sans-serif`;
    const w1 = ctx.measureText(plain.stopped).width;
    ctx.font = `500 ${11.5 * k}px ui-monospace, Menlo, monospace`;
    const w2 = ctx.measureText(plain.flag).width;
    const tw = Math.max(w1, w2);
    const cx = X(-ring.r + 2 * ring.r * ring.at[1]);
    const lx = cx - tw / 2;
    const ly = X(ring.at[0] === "top" ? -ring.r : ring.r);
    ctx.fillStyle = C.ink;
    ctx.fillRect(lx - 10 * k, ly - 13 * k, tw + 20 * k, 40 * k);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.globalAlpha = hot ? 1 : 0.9;
    ctx.fillStyle = hot ? C.paper : C.vultrSoft;
    ctx.font = `700 ${16 * k}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(plain.stopped, cx, ly);
    ctx.fillStyle = C.dim;
    ctx.font = `500 ${11.5 * k}px ui-monospace, Menlo, monospace`;
    ctx.fillText(plain.flag, cx, ly + 17 * k);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  });
  ctx.font = `700 ${12 * k}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = escaped ? C.alarm : C.vultrSoft;
  ctx.textAlign = "right";
  ctx.fillText(escaped ? "SANDBOX BREACHED" : "VULTR SANDBOX", X(RINGS[RINGS.length - 1]!.r) - 20 * k, X(-RINGS[RINGS.length - 1]!.r) + 22 * k);
  ctx.textAlign = "left";

  drawWall(ctx, state, s, t, X, u, k, px);

  // The agents: a glowing body, a blinking cursor for an eye, and the command they just ran.
  const count = Math.max(1, state?.agents ?? 1);
  for (let i = 0; i < count; i++) {
    const d = dot(s, i);
    const color = AGENT_COLORS[i % AGENT_COLORS.length] ?? C.amber;
    const cx = X(d.x);
    const cy = X(d.y);
    const size = 13 * k;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 3.2);
    glow.addColorStop(0, `${color}88`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = state?.phase === "lobby" ? 0.5 : 1;
    ctx.fillStyle = color;
    roundRectFill(ctx, cx - size, cy - size * 0.85, size * 2, size * 1.7, size * 0.55);
    const blink = s.reduced || Math.floor(t / 450 + i) % 2 === 0;
    if (blink) {
      ctx.fillStyle = C.ink;
      ctx.fillRect(cx - size * 0.15, cy - size * 0.45, size * 0.32, size * 0.9);
    }
    ctx.globalAlpha = 1;
    if (d.trail) {
      const age = (t - d.trail.at) / 3200;
      if (age < 1) {
        ctx.globalAlpha = 1 - age;
        ctx.font = `500 ${13 * k}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(d.trail.text, cx, cy - size * 1.4);
        ctx.globalAlpha = 1;
        ctx.textAlign = "left";
      } else {
        d.trail = null;
      }
    }
  }

  // What stopped it, at the spot it was stopped.
  for (const f of s.flashes) {
    if (!f.through) continue;
    const age = (t - f.at) / 2600;
    ctx.globalAlpha = Math.min(1, 2 * (1 - age));
    const title = `${plainLayer(f.layer, s.runtime).stopped}`;
    callout(ctx, X(f.x), X(f.y), title, f.text, f.color, k, w);
    ctx.globalAlpha = 1;
  }
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  state: RoomState | null,
  s: Scene,
  t: number,
  X: (v: number) => number,
  u: number,
  k: number,
  px: number,
): void {
  const wall = state?.wall ?? "";
  const n = wall.length;
  if (n === 0) {
    ctx.strokeStyle = C.paperDim;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([8 * k, 10 * k]);
    roundRect(ctx, X(-WALL), X(-WALL), WALL * 2 * u, WALL * 2 * u, 6 * k);
    ctx.setLineDash([]);
    return;
  }
  const perimeter = 8 * WALL * u;
  const gapPx = Math.min(5 * k, perimeter / n / 4);
  const thick = Math.max(8 * k, Math.min(26 * k, (perimeter / n) * 0.6));
  for (let i = 0; i < n; i++) {
    const c = wall[i];
    const a = i / n;
    const b = (i + 1) / n;
    const hit = s.bricks.find((x) => x.index === i);
    // Each brick is drawn along the perimeter from a to b, short of its neighbours by a mortar gap.
    const pad = gapPx / perimeter;
    const steps = Math.max(2, Math.ceil((b - a) * 200));
    const pts: [number, number][] = [];
    for (let j = 0; j <= steps; j++) pts.push(pt(a + pad + ((b - a - 2 * pad) * j) / steps, WALL));
    if (c === "2") {
      // A door: the brick swung outward on an amber hinge, and the opening left dark.
      const [hx, hy] = pts[0]!;
      const [nx, ny] = normal((a + b) / 2);
      const len = Math.hypot(pts[pts.length - 1]![0] - hx, pts[pts.length - 1]![1] - hy);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = thick * 0.45;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(X(hx), X(hy));
      ctx.lineTo(X(hx + nx * len), X(hy + ny * len));
      ctx.stroke();
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.arc(X(hx), X(hy), thick * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineCap = "butt";
      continue;
    }
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    if (c === "1") {
      const jolt = hit ? Math.sin(((t - hit.at) / 500) * Math.PI * 3) * (1 - (t - hit.at) / 500) * 0.012 : 0;
      ctx.strokeStyle = hit ? "#ffffff" : C.paper;
      ctx.lineWidth = thick;
      polyline(ctx, pts.map(([x, y]) => [X(x * (1 - jolt)), X(y * (1 - jolt))]));
      // A course line, so a row of pieces reads as bricks.
      ctx.strokeStyle = "#d9cfb5";
      ctx.lineWidth = Math.max(1, thick * 0.08);
      polyline(ctx, pts.map(([x, y]) => [X(x), X(y)]));
    } else {
      ctx.strokeStyle = C.paperDim;
      ctx.lineWidth = Math.max(1.5 * px, thick * 0.12);
      ctx.setLineDash([3 * k, 4 * k]);
      polyline(ctx, pts.map(([x, y]) => [X(x), X(y)]));
      ctx.setLineDash([]);
    }
  }
}

function polyline(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], j) => (j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
}

function roundRectFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function callout(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, text: string, color: string, k: number, w: number): void {
  ctx.font = `700 ${13 * k}px ui-monospace, Menlo, monospace`;
  const tw = Math.max(ctx.measureText(title).width, (ctx.font = `500 ${12.5 * k}px ui-monospace, Menlo, monospace`, ctx.measureText(text).width));
  const bw = tw + 22 * k;
  const bh = 46 * k;
  const bx = Math.min(w - bw - 8 * k, Math.max(8 * k, x - bw / 2));
  const by = Math.min(w - bh - 8 * k, Math.max(8 * k, y - bh - 18 * k));
  ctx.fillStyle = "#0d1a44";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6 * k);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${13 * k}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = "#4da3ff";
  ctx.fillText(title, bx + 11 * k, by + 8 * k);
  ctx.font = `500 ${12.5 * k}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = "#f1ead9";
  ctx.fillText(text, bx + 11 * k, by + 26 * k);
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, taken: boolean): void {
  ctx.strokeStyle = "#8d97b8";
  ctx.lineWidth = s * 0.1;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y + s * 0.6);
  ctx.lineTo(x - s * 0.4, y - s * 0.6);
  ctx.stroke();
  ctx.fillStyle = taken ? "#ff5d4d" : "#f1ead9";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y - s * 0.6);
  ctx.lineTo(x + s * 0.55, y - s * 0.3);
  ctx.lineTo(x - s * 0.4, y);
  ctx.closePath();
  ctx.fill();
}

function drawBeacon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, still: boolean): void {
  ctx.fillStyle = "#8d97b8";
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.2);
  ctx.lineTo(x - s * 0.35, y + s * 0.6);
  ctx.lineTo(x + s * 0.35, y + s * 0.6);
  ctx.closePath();
  ctx.fill();
  const pulse = still ? 0.5 : (t / 1600) % 1;
  ctx.strokeStyle = "#8d97b8";
  ctx.lineWidth = s * 0.07;
  for (const r of [0.5, 0.85]) {
    ctx.globalAlpha = still ? 0.5 : Math.max(0, 1 - pulse) * 0.8;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.25, s * (r + pulse * 0.4), Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
