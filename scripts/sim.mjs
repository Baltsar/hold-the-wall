// A rehearsal without people: opens a room, connects N fake phones that hold and let go at random,
// starts the show, accepts the first offer, and prints what the stage would show. Needs a running server.
//   node scripts/sim.mjs [phones=40] [origin=http://localhost:3000]
// With CODE=<room> only the phones join an existing room (its stage is open in a browser), for a look.
import WebSocket from "ws";

const phones = Number(process.argv[2] ?? 40);
const origin = process.argv[3] ?? "http://localhost:3000";
const wsUrl = `${origin.replace(/^http/, "ws")}/ws`;
let code = process.env.CODE;
let ownerToken = "";
if (!code) {
  const res = await fetch(`${origin}/api/room`, { method: "POST", headers: { "content-type": "application/json", ...(process.env.SHOW_KEY ? { "x-show-key": process.env.SHOW_KEY } : {}) }, body: "{}" });
  ({ code, ownerToken } = await res.json());
}
console.log(`room ${code}, ${phones} phones`);

let kicked = 0;
let opened = false;
const id = () => Math.random().toString(36).slice(2, 10);
function phone(i) {
  const ws = new WebSocket(wsUrl);
  let held = false;
  let timer;
  ws.on("open", () => {
    ws.send(JSON.stringify({ t: "hello", v: 1, id: id(), room: code, clientId: `sim-${i}`, role: "audience" }));
    ws.send(JSON.stringify({ t: "join", v: 1, id: id() }));
    timer = setInterval(() => {
      const next = held ? Math.random() > 0.06 : Math.random() < 0.5;
      if (next !== held) ws.send(JSON.stringify({ t: "hold", v: 1, id: id(), on: next }));
      else ws.send(JSON.stringify({ t: "ping", v: 1, id: "p", seq: 0 }));
      held = next;
    }, 700 + Math.random() * 600);
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === "kicked") kicked++;
    if (msg.t === "offer" && !opened && Math.random() < 0.5) {
      opened = true;
      setTimeout(() => ws.send(JSON.stringify({ t: "open", v: 1, id: id(), offer: msg.offer })), 2000);
      console.log(`phone ${i} was offered the door and opens it`);
    } else if (msg.t === "offer") console.log(`phone ${i} was offered the door and lets it pass`);
  });
  ws.on("close", () => clearInterval(timer));
  return ws;
}
const all = Array.from({ length: phones }, (_, i) => phone(i));

if (process.env.CODE) {
  setTimeout(() => {
    for (const ws of all) ws.close();
    process.exit(0);
  }, Number(process.env.SECONDS ?? 120) * 1000);
}
const stage = process.env.CODE ? null : new WebSocket(wsUrl);
if (stage) {
let lastN = 0;
stage.on("open", () => {
  stage.send(JSON.stringify({ t: "hello", v: 1, id: id(), room: code, clientId: "sim-stage", role: "master", token: ownerToken }));
  setTimeout(() => stage.send(JSON.stringify({ t: "command", v: 1, id: id(), command: { kind: "start" } })), 2000);
});
stage.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.t !== "state") return;
  const a = msg.feed?.at(-1);
  if (a && a.n > lastN) {
    lastN = a.n;
    console.log(`#${a.n} ${a.verdict.padEnd(9)} via ${a.via.kind.padEnd(4)} wall ${msg.wall} ${a.source} $ ${a.command.slice(0, 60)}`);
  }
  if (msg.door != null && !stage.doorSeen) {
    stage.doorSeen = true;
    console.log(`door visible at ${msg.door.toFixed(2)}`);
  }
  if (msg.reveal && msg.reveal.sha256 && !stage.done) {
    stage.done = true;
    console.log("reveal", JSON.stringify(msg.reveal));
    console.log(`kicked phones: ${kicked}`);
    for (const ws of all) ws.close();
    stage.close();
  }
});
}
