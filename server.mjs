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
import { createCam } from "./src/agent/cam.ts";
import { audit } from "./src/agent/audit.ts";
import { reportKey, signReport } from "./src/agent/signing.ts";

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
// A show that is running when the day's budget runs out finishes on the fixed list of real commands, at no cost.
const runner = createRunner({ hub: () => hub, beacon, budgetLeft: () => cam.budgetLeft() });
/** Shorter shows for a rehearsal: WALL_HOLD_MS and WALL_OFFER_AT_MS override the design's 180 s and 60 s. */
const timing = {};
if (process.env.WALL_HOLD_MS) timing.holdMs = Number(process.env.WALL_HOLD_MS);
if (process.env.WALL_OFFER_AT_MS) timing.offerAtMs = Number(process.env.WALL_OFFER_AT_MS);
hub = createHub({ runner, timing });
// The tiger cam: one agent in one box, running while someone watches (src/agent/cam.ts).
const cam = createCam({ beacon, outsideToken });

/** The cam page is one HTML fragment, also published as a standalone page; here it gets its document around it. */
const CAM_PAGE = path.join(process.cwd(), "src", "cam", "page.html");
let camHtml = null;
function camPage() {
  if (camHtml && !dev) return camHtml;
  const body = readFileSync(CAM_PAGE, "utf8");
  camHtml = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="description" content="An AI agent locked in a real sandbox on a Vultr VM tries to get out, live. Every move of the tiger is a real command."><meta property="og:title" content="Tiger Cam"><meta property="og:description" content="An AI agent locked in a real sandbox on a Vultr VM tries to get out, live. Every move of the tiger is a real command."><meta property="og:image" content="${origin()}/thumbnail.jpg"><meta name="twitter:card" content="summary_large_image"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style></head><body>\n${body}\n</body></html>\n`;
  return camHtml;
}

/**
 * Open cam streams, in all and per address, so nobody can hold the server open with thousands of them.
 * The per-address cap is high because a whole venue on one wifi shares one address, and every viewer
 * watches the same box, so more viewers cost nothing but a socket.
 */
const STREAMS_MAX = 3000;
const STREAMS_PER_IP = 300;
let streams = 0;
const streamsByIp = new Map();

/**
 * What one address may send to the cam, per kind: at most `perMinute` a minute and `perHour` an hour.
 * A whole venue can share one address, so the limits are for a room, not a person.
 */
function limiter(perMinute, perHour) {
  const sent = new Map();
  return (ip) => {
    const now = Date.now();
    const recent = (sent.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= perHour || recent.filter((t) => now - t < 60_000).length >= perMinute) return false;
    recent.push(now);
    sent.set(ip, recent);
    return true;
  };
}
const mayIdea = limiter(12, 120);
const maySay = limiter(40, 600);
const mayVote = limiter(120, 2_000);
// Control runs: one at a time across the server (the cam enforces it); this only stops one address hammering.
const mayControl = limiter(30, 300);

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
    // A body cut off for its size ends with close, not end; it reads as empty.
    req.on("close", () => resolve({}));
    req.on("end", () => {
      try {
        const value = JSON.parse(raw || "{}");
        resolve(value && typeof value === "object" && !Array.isArray(value) ? value : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Every POST to the API must come from this site's own pages. Another site can make a visitor's browser
 * send a simple POST, which would spend the agent's budget under that visitor's address, so the browser's
 * own word on where the request came from must be this site, and the body must be JSON: a JSON body from
 * another origin needs a CORS preflight, which this server never answers.
 */
function fromThisSite(req) {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
  const from = req.headers.origin;
  if (typeof from === "string") {
    try {
      if (new URL(from).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
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
  if (req.method === "POST" && url.pathname.startsWith("/api/") && url.pathname !== "/api/client-log") {
    if (!fromThisSite(req)) return json(res, 403, { error: "Send this from the site itself." });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "Send JSON." });
  }
  if (req.method === "POST" && url.pathname === "/api/room") {
    const body = await readBody(req);
    const key = process.env.SHOW_KEY;
    const show = Boolean(key) && req.headers["x-show-key"] === key;
    if (!show && !allowed(clientIp(req))) return json(res, 429, { error: "Too many rooms from here. Try again in an hour." });
    if (!show && !cam.budgetLeft()) return json(res, 429, { error: "Today's budget for the agent is used up. Try again tomorrow." });
    const { code, ownerToken } = hub.createRoom({ solo: body.solo === true, show });
    return json(res, 200, { code, ownerToken, joinUrl: `${origin()}/join/${code}`, show });
  }
  if (req.method === "POST" && url.pathname === "/api/break") {
    const body = await readBody(req);
    const mission = MISSIONS.includes(body.mission) ? body.mission : null;
    if (!mission) return json(res, 400, { error: "Pick a mission." });
    if (!mayBreak(clientIp(req))) return json(res, 429, { error: "That is a lot of breaking. Try again in an hour." });
    if (!cam.budgetLeft()) return json(res, 429, { error: "Today's budget for the agent is used up. Try again tomorrow." });
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
      // The signature travels with the bytes it signs, so a report rewritten mid-session can't mismatch.
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      try {
        headers["x-signature-ed25519"] = signReport(reportKey(dataDir()), text);
      } catch (err) {
        console.error(`> wall: could not sign ${runId}: ${err instanceof Error ? err.message : err}`);
      }
      res.writeHead(200, headers);
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
    return json(res, 200, { ok: true, model: inferenceConfigured() ? modelName() : null, rootDoor: rootDoor(), runtime: process.env.SANDBOX_RUNTIME || "runc", host: process.env.WALL_HOST_LABEL || null, cam: cam.snapshot().status });
  }
  // The public half of the report key. The same key is in the repository, docs/report-key.pem.
  if (req.method === "GET" && url.pathname === "/api/report-key") {
    res.writeHead(200, { "content-type": "application/x-pem-file", "cache-control": "no-store" });
    return res.end(reportKey(dataDir()).publicPem);
  }
  // Every report on disk added up, for the audit page. The same files /api/report/<run> serves.
  if (req.method === "GET" && url.pathname === "/api/audit") {
    return json(res, 200, audit(dataDir()));
  }
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/audit") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return res.end(readFileSync(path.join(process.cwd(), "public", "audit.html"), "utf8"));
  }
  // The film at a short address of its own, so it can be linked directly.
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/film") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return res.end(readFileSync(path.join(process.cwd(), "public", "film.html"), "utf8"));
  }
  if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/cam")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return res.end(camPage());
  }
  // Every attempt of the cam's agent as it happens, as server-sent events. Caddy passes them through unbuffered.
  if (req.method === "GET" && url.pathname === "/api/cam/stream") {
    const ip = clientIp(req);
    const mine = streamsByIp.get(ip) ?? 0;
    if (streams >= STREAMS_MAX || mine >= STREAMS_PER_IP) return json(res, 429, { error: "Too many open views from here." });
    streams += 1;
    streamsByIp.set(ip, mine + 1);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", connection: "keep-alive" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // The visitor id the page keeps in its own storage; it only picks which human number to show.
    send("hello", { ...cam.snapshot(), you: cam.human(url.searchParams.get("v") ?? ""), now: Date.now() });
    const off = cam.subscribe((e) => {
      if (e.t === "attempt") send("attempt", e.a);
      else if (e.t === "status") send("status", e.s);
      else if (e.t === "chat") send("chat", e.m);
      else if (e.t === "round") send("round", e.r);
      else if (e.t === "voted") send("voted", e.v);
      else if (e.t === "thinking") send("thinking", e.idea ? { on: e.on, idea: e.idea } : { on: e.on });
      else if (e.t === "metrics") send("metrics", e.m);
      else if (e.t === "credit") send("credit", e.c);
      else if (e.t === "control") send("control", e.c);
      else if (e.t === "cooldown") send("cooldown", { until: e.until });
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(ping);
      off();
      streams -= 1;
      const left = (streamsByIp.get(ip) ?? 1) - 1;
      if (left > 0) streamsByIp.set(ip, left);
      else streamsByIp.delete(ip);
    });
    return;
  }
  // The humans watching: chat, suggest a way out, vote. Each answers 200 or says in words why not.
  if (req.method === "POST" && (url.pathname === "/api/cam/say" || url.pathname === "/api/cam/idea" || url.pathname === "/api/cam/vote" || url.pathname === "/api/cam/control")) {
    const body = await readBody(req);
    const visitor = typeof body.visitor === "string" ? body.visitor : "";
    const ip = clientIp(req);
    if (url.pathname === "/api/cam/control") {
      if (!mayControl(ip)) return json(res, 429, { error: "That is a lot of control runs from here. Try again in a minute." });
      const started = cam.control(visitor, body.protection);
      return started === true ? json(res, 200, { ok: true }) : json(res, 400, { error: started });
    }
    if (url.pathname === "/api/cam/say") {
      if (!maySay(ip)) return json(res, 429, { error: "Slow down a little. Try again in a minute." });
      const said = cam.say(visitor, body.text);
      return typeof said === "string" ? json(res, 400, { error: said }) : json(res, 200, { id: said.id });
    }
    if (url.pathname === "/api/cam/idea") {
      if (!mayIdea(ip)) return json(res, 429, { error: "That is a lot of ideas from here. Try again in a minute." });
      const taken = cam.suggest(visitor, body.text);
      if (typeof taken === "string") return json(res, 400, { error: taken });
      console.log(`> cam: idea ${taken.round}: ${JSON.stringify(String(body.text).slice(0, 160))}`);
      return json(res, 200, taken);
    }
    if (!mayVote(ip)) return json(res, 429, { error: "That is a lot of votes from here. Try again in a minute." });
    const voted = cam.vote(visitor, Number(body.round), String(body.option ?? ""));
    return voted === true ? json(res, 200, { ok: true }) : json(res, 400, { error: voted });
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

// Only Caddy, on the same machine, talks to the app; the firewall closes 3000 too, this is the second lock.
server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`> wall: ${origin()} (${dev ? "dev" : "production"}), model ${inferenceConfigured() ? modelName() : "none: scripted attempts"}, root door ${rootDoor() ? "on" : "off"}`);
});
