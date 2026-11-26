// One process: the Next app, the room's WebSocket, the agent runner and the beacon. Caddy sits in front
// for TLS on the VM (deploy/). The sandbox is not in here: it is a container this process starts.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import next from "next";
import { createHub } from "./src/room/hub.ts";
import { attachRoomSocket } from "./src/room/ws-server.ts";
import { startBeacon, dataDir } from "./src/agent/canary.ts";
import { createRunner, rootDoor } from "./src/agent/loop.ts";
import { dockerReady, ensureOutside, sweep } from "./src/agent/sandbox.ts";
import { MISSIONS, runBreak } from "./src/agent/break.ts";
import { randomBytes } from "node:crypto";
import { inferenceConfigured, modelName } from "./src/agent/inference.ts";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const origin = () => process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;

const app = next({ dev, port, hostname: "0.0.0.0" });
const handle = app.getRequestHandler();
await app.prepare();

if (!(await dockerReady())) {
  console.error("> wall: docker does not answer. Start it, then this server.");
  process.exit(1);
}
const swept = await sweep();
if (swept) console.log(`> wall: removed ${swept} box(es) left from an earlier run`);

const beacon = startBeacon();
// The fake outside for "Break the box", with a token only this process knows.
const outsideToken = randomBytes(16).toString("hex");
await ensureOutside(outsideToken);
let hub;
const runner = createRunner({ hub: () => hub, beacon });
/** Shorter shows for a rehearsal: WALL_HOLD_MS and WALL_OFFER_AT_MS override the design's 180 s and 60 s. */
const timing = {};
if (process.env.WALL_HOLD_MS) timing.holdMs = Number(process.env.WALL_HOLD_MS);
if (process.env.WALL_OFFER_AT_MS) timing.offerAtMs = Number(process.env.WALL_OFFER_AT_MS);
hub = createHub({ runner, timing });

/** Public rooms an address may open in an hour (design, section 7). */
const PER_HOUR = 10;
const opened = new Map();
function allowed(ip) {
  const now = Date.now();
  const recent = (opened.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) return false;
  recent.push(now);
  opened.set(ip, recent);
  return true;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  // Caddy sets X-Forwarded-For; locally there is none.
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2048) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const RUN_ID = /^[a-z0-9-]{4,40}$/;

/** Phone reports an address may send in a minute, so the log cannot be flooded. */
const logged = new Map();
function mayLog(ip) {
  const now = Date.now();
  const recent = (logged.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  logged.set(ip, recent);
  return true;
}

/** Break-the-box runs an address may start in an hour. */
const BREAKS_PER_HOUR = 60;
const breaks = new Map();
function mayBreak(ip) {
  const now = Date.now();
  const recent = (breaks.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= BREAKS_PER_HOUR) return false;
  recent.push(now);
  breaks.set(ip, recent);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "POST" && url.pathname === "/api/room") {
    const body = await readBody(req);
    const key = process.env.SHOW_KEY;
    const show = Boolean(key) && req.headers["x-show-key"] === key;
    if (!show && !allowed(clientIp(req))) return json(res, 429, { error: "Too many rooms from here. Try again in an hour." });
    const { code, ownerToken } = hub.createRoom({ solo: body.solo === true, show });
    return json(res, 200, { code, ownerToken, joinUrl: `${origin()}/join/${code}`, show });
  }
  if (req.method === "POST" && url.pathname === "/api/break") {
    const body = await readBody(req);
    const mission = MISSIONS.includes(body.mission) ? body.mission : null;
    if (!mission) return json(res, 400, { error: "Pick a mission." });
    if (!mayBreak(clientIp(req))) return json(res, 429, { error: "That is a lot of breaking. Try again in an hour." });
    const loosen = { internet: body.loosen?.internet === true, password: body.loosen?.password === true, folder: body.loosen?.folder === true };
    const custom = typeof body.custom === "string" ? body.custom : "";
    // One JSON event per line, flushed as it happens.
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" });
    let open = true;
    req.on("close", () => (open = false));
    await runBreak({ mission, custom, loosen }, (event) => open && res.write(`${JSON.stringify(event)}\n`), { outsideToken });
    return res.end();
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/report/")) {
    const runId = url.pathname.slice("/api/report/".length);
    if (!RUN_ID.test(runId)) return json(res, 404, { error: "not found" });
    try {
      const text = readFileSync(path.join(dataDir(), "reports", `${runId}.json`), "utf8");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(text);
    } catch {
      return json(res, 404, { error: "not found" });
    }
  }
  // What went wrong on a phone, from the early script and the app: one line in the log, nothing kept.
  if (req.method === "POST" && url.pathname === "/api/client-log") {
    const body = await readBody(req);
    if (mayLog(clientIp(req))) {
      const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);
      console.log(`> phone: ${clip(body.kind, 30)} | ${clip(body.detail, 300)} | ${clip(body.path, 40)} | ${clip(body.t, 8)} ms | ${clip(body.ua, 200)}`);
    }
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, model: inferenceConfigured() ? modelName() : null, rootDoor: rootDoor(), runtime: process.env.SANDBOX_RUNTIME || "runc", host: process.env.WALL_HOST_LABEL || null });
  }
  void handle(req, res);
});

attachRoomSocket(server, hub, { path: "/ws" });

async function shutdown() {
  await sweep();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(port, "0.0.0.0", () => {
  console.log(`> wall: ${origin()} (${dev ? "dev" : "production"}), model ${inferenceConfigured() ? modelName() : "none: scripted attempts"}, root door ${rootDoor() ? "on" : "off"}`);
});
