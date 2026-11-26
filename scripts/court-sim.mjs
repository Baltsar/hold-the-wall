// Simulations for the paddle-game idea, run before anything is built: how often a person misses at
// different ball speeds, what ten courts at once cost the VM and the model, and a rough model of how a
// visitor goes from confused to "aha". Numbers marked ASSUMED are guesses to reason with, not data.
//   node scripts/court-sim.mjs

// A seeded random, so the results are the same every run.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

// 1. The game: a ball against a person's paddle.
// ASSUMED: reaction time 250 ms (sd 60), paddle top speed 1.4 court heights/s, half-height 0.09,
// aim error sd 0.035. Ball speed in court widths per second.
function missRate(speed, { reaction = 0.25, sd = 0.06, paddleSpeed = 1.4, half = 0.09, aim = 0.035 } = {}) {
  let misses = 0;
  const tries = 20000;
  for (let i = 0; i < tries; i++) {
    const angle = (rand() - 0.5) * 1.6; // up to about 45 degrees
    const vy = Math.tan(angle) * speed;
    const travel = 1 / speed; // seconds across the court
    // Where the ball arrives, folding at the top and bottom walls.
    let y = 0.5 + vy * travel + (rand() - 0.5) * 0.4;
    y = Math.abs(y % 2);
    if (y > 1) y = 2 - y;
    const start = 0.5 + (rand() - 0.5) * 0.3;
    const react = Math.max(0.1, reaction + sd * gauss());
    const time = Math.max(0, travel - react);
    const reach = paddleSpeed * time;
    const target = y + aim * gauss();
    const end = Math.abs(target - start) <= reach ? target : start + Math.sign(target - start) * reach;
    if (Math.abs(end - y) > half) misses++;
  }
  return misses / tries;
}

console.log("1. HOW OFTEN A PERSON MISSES");
console.log("speed (court/s)  miss per ball  misses per minute  read");
for (const v of [0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.2]) {
  const p = missRate(v);
  const perMin = (60 * v / 2) * p; // the ball comes to your side once per two crossings
  const read = perMin < 2 ? "too easy: nothing happens" : perMin > 12 ? "too hard: feels unfair" : perMin <= 8 ? "good: a miss every 8-25 s" : "frantic";
  console.log(`${v.toFixed(1).padStart(6)}          ${(100 * p).toFixed(0).padStart(3)}%          ${perMin.toFixed(1).padStart(5)}            ${read}`);
}

// 2. Ten courts at once: what the VM and the model see.
// From our own runs: a model turn every ~4 s per agent, ~2,400 prompt + ~200 answer tokens per turn.
// ASSUMED: 15% of commands are heavy (a loop, a fork bomb, a big allocation) and use their CPU cap
// for the full 10 s; the rest use it for under 0.3 s.
function load(courts, cpuCap, vcpus, liveCourts) {
  const sims = 20000;
  let overloaded = 0;
  for (let s = 0; s < sims; s++) {
    let busy = 0;
    for (let c = 0; c < courts; c++) {
      // Chance a court is inside a heavy command at a random moment: 0.15 * 10 s / (4 s cadence + 10 s run)
      if (rand() < (0.15 * 10) / (4 + 0.15 * 10 + 0.85 * 0.3)) busy += cpuCap;
      else if (rand() < 0.3 / 4.3) busy += cpuCap;
    }
    if (busy > vcpus * 0.85) overloaded++;
  }
  const calls = (liveCourts * 60) / 4;
  return { overloaded: overloaded / sims, calls, tokens: calls * 2600 };
}

console.log("\n2. TEN COURTS ON ONE VM (2 vCPU today)");
console.log("setup                                     moments over 85% CPU   model calls/min   tokens/min");
const setups = [
  ["10 courts, 0.5 CPU each, all live model", 10, 0.5, 2, 10],
  ["10 courts, 0.2 CPU each, all live model", 10, 0.2, 2, 10],
  ["10 courts, 0.2 CPU, live only in 2 focused", 10, 0.2, 2, 2],
  ["10 courts, 0.5 CPU, 4 vCPU VM, 2 live", 10, 0.5, 4, 2],
];
for (const [name, n, cap, v, live] of setups) {
  const r = load(n, cap, v, live);
  console.log(`${name.padEnd(42)} ${(100 * r.overloaded).toFixed(1).padStart(6)}%              ${String(r.calls).padStart(5)}          ${String(r.tokens).padStart(7)}`);
}

// 3. A visitor, step by step (5 s steps, 2 minutes). States: confused, curious, playing, aha, gone.
// ASSUMED transition chances per step. They are guesses; what matters is which of them decides the result.
function visitor(design, steps = 24) {
  const d = design;
  let state = "confused";
  for (let i = 0; i < steps; i++) {
    const r = rand();
    if (state === "confused") state = r < d.understand ? "curious" : r < d.understand + d.leaveConfused ? "gone" : "confused";
    else if (state === "curious") state = r < d.startPlaying ? "playing" : r < d.startPlaying + 0.03 ? "gone" : "curious";
    else if (state === "playing") state = r < d.aha ? "aha" : r < d.aha + d.bored ? "gone" : "playing";
    if (state === "aha" || state === "gone") return { state, at: (i + 1) * 5 };
  }
  return { state, at: steps * 5 };
}

const designs = {
  "A. One court, you play": { understand: 0.55, leaveConfused: 0.03, startPlaying: 0.6, aha: 0.1, bored: 0.03 },
  "B. Ten courts, no focus": { understand: 0.2, leaveConfused: 0.08, startPlaying: 0.35, aha: 0.05, bored: 0.05 },
  "C. Ten courts, you play one, the camera cuts to drama": { understand: 0.45, leaveConfused: 0.04, startPlaying: 0.6, aha: 0.16, bored: 0.025 },
};

console.log("\n3. A VISITOR IN TWO MINUTES (10,000 simulated, ASSUMED chances)");
console.log("design                                                   aha     median time to aha   left confused or bored");
for (const [name, d] of Object.entries(designs)) {
  const out = Array.from({ length: 10000 }, () => visitor(d));
  const aha = out.filter((o) => o.state === "aha");
  const times = aha.map((o) => o.at).sort((a, b) => a - b);
  const gone = out.filter((o) => o.state === "gone").length;
  console.log(`${name.padEnd(56)} ${(aha.length / 100).toFixed(0).padStart(3)}%    ${String(times[Math.floor(times.length / 2)] ?? "-").padStart(4)} s               ${(gone / 100).toFixed(0).padStart(3)}%`);
}

// Which guess decides it: how good must B's understanding be to match A?
console.log("\n   What B would need to match A:");
for (const u of [0.2, 0.35, 0.5]) {
  for (const a of [0.05, 0.1, 0.16]) {
    const d = { ...designs["B. Ten courts, no focus"], understand: u, aha: a };
    const out = Array.from({ length: 6000 }, () => visitor(d));
    const p = out.filter((o) => o.state === "aha").length / 60;
    process.stdout.write(`   understand ${u.toFixed(2)} aha ${a.toFixed(2)} -> ${p.toFixed(0)}%   `);
  }
  process.stdout.write("\n");
}
