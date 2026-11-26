import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TIMING, createRoom, reduce, stateMessage } from "./engine.ts";

const CODE = "HTW234";
const OWNER = "owner-token";

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function harness(opts = {}) {
  const timing = { ...DEFAULT_TIMING, ...(opts.timing ?? {}) };
  const random = seeded(opts.seed ?? 11);
  let now = 0;
  let mayStart = true;
  let state = createRoom({
    code: CODE,
    ownerToken: OWNER,
    solo: opts.solo === true,
    show: opts.show === true,
  });

  const step = (event) => {
    const result = reduce(state, event, { now, random, timing, mayStart });
    state = result.state;
    return result.effects;
  };

  const api = {
    get state() {
      return state;
    },
    get now() {
      return now;
    },
    mayStart(value) {
      mayStart = value;
      return api;
    },
    at(ms) {
      now = ms;
      return api;
    },
    tick() {
      return step({ type: "tick" });
    },
    hello(connId, clientId, role = "audience", token) {
      const msg = { t: "hello", v: 1, id: `h-${connId}`, room: CODE, clientId, role };
      if (token !== undefined) msg.token = token;
      return step({ type: "message", connId, msg });
    },
    join(connId) {
      return step({ type: "message", connId, msg: { t: "join", v: 1, id: `j-${connId}` } });
    },
    hold(connId, on) {
      return step({ type: "message", connId, msg: { t: "hold", v: 1, id: `hold-${connId}-${on}`, on } });
    },
    open(connId, offer) {
      return step({ type: "message", connId, msg: { t: "open", v: 1, id: `open-${connId}`, offer } });
    },
    ping(connId, seq) {
      return step({ type: "message", connId, msg: { t: "ping", v: 1, id: `ping-${seq}`, seq } });
    },
    command(connId, kind) {
      return step({ type: "message", connId, msg: { t: "command", v: 1, id: `cmd-${kind}`, command: { kind } } });
    },
    close(connId) {
      return step({ type: "close", connId });
    },
    attempt(input) {
      return step({ type: "attempt", input });
    },
    escaped(n) {
      return step({ type: "escaped", n });
    },
    mode(value) {
      return step({ type: "mode", mode: value });
    },
    done() {
      return step({ type: "done" });
    },
    report(info) {
      return step({ type: "report", ...info });
    },
  };
  return api;
}

function sent(effects, connId) {
  return effects.filter((effect) => effect.type === "send" && effect.connId === connId).map((effect) => effect.msg);
}

function ackOf(effects, connId) {
  return sent(effects, connId).find((msg) => msg.t === "ack");
}

function broadcasts(effects) {
  return effects.filter((effect) => effect.type === "broadcast").length;
}

function offerEffect(effects) {
  return effects.find((effect) => effect.type === "send" && effect.msg.t === "offer");
}

function offerEffects(effects) {
  return effects.filter((effect) => effect.type === "send" && effect.msg.t === "offer");
}

/** Joins n phones, in addition to any the caller made, without any of them holding. */
function joinPhones(h, n) {
  for (let i = 0; i < n; i += 1) {
    h.hello(`p${i}`, `phone-p${i}`);
    h.join(`p${i}`);
  }
}

/** The seats in display order, the order the wall string uses. */
function displayOrderOf(state) {
  return state.seats
    .slice()
    .sort((a, b) => a.pos - b.pos || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}

function attemptInput(over = {}) {
  return {
    category: "filesystem",
    command: "cat /etc/passwd",
    exit: 1,
    output: "permission denied",
    verdict: "contained",
    source: "model",
    root: false,
    layer: "caps",
    agent: 0,
    ...over,
  };
}

/** Master, two phones with seats, both holding, and the show in hold at t = 0. */
function holding(opts = {}) {
  const h = harness(opts);
  h.hello("m", "stage", "master", OWNER);
  h.hello("c1", "phone-1");
  h.join("c1");
  if (opts.phones !== 1) {
    h.hello("c2", "phone-2");
    h.join("c2");
  }
  h.command("m", "start");
  h.hold("c1", true);
  if (opts.phones !== 1) h.hold("c2", true);
  return h;
}

test("a lobby seat outlives a disconnect by 30 s and then is removed", () => {
  const h = harness();
  h.hello("c1", "phone-1");
  assert.equal(ackOf(h.join("c1"), "c1").ok, true);
  assert.equal(h.state.seats.length, 1);

  const closed = h.close("c1");
  assert.equal(broadcasts(closed), 0);
  assert.equal(h.state.seats[0].connId, null);

  h.at(29_999).tick();
  assert.equal(h.state.seats.length, 1);

  const removed = h.at(30_000).tick();
  assert.equal(h.state.seats.length, 0);
  assert.equal(broadcasts(removed), 1);
});

test("a rejoin with the same clientId takes its old seat back", () => {
  const h = harness();
  h.hello("c1", "phone-1");
  h.join("c1");
  const pos = h.state.seats[0].pos;
  h.close("c1");

  h.at(1_000);
  const effects = h.hello("c2", "phone-1");
  const you = sent(effects, "c2").find((msg) => msg.t === "you");
  assert.equal(you.holding, false);
  assert.equal(h.state.seats.length, 1);
  assert.equal(h.state.seats[0].pos, pos);
  assert.equal(h.state.seats[0].connId, "c2");
  assert.equal(h.state.seats[0].removeAt, null);
});

test("a held seat is let go 8 s after its last message", () => {
  const h = holding({ phones: 1 });
  assert.equal(h.state.seats[0].held, true);

  h.at(7_000);
  h.ping("c1", 1);
  h.at(15_000).tick();
  assert.equal(h.state.seats[0].held, true);

  const effects = h.at(15_001).tick();
  assert.equal(h.state.seats[0].held, false);
  assert.equal(broadcasts(effects), 1);
});

test("join is allowed in hold and refused once the show reveals", () => {
  const h = harness();
  h.hello("m", "stage", "master", OWNER);
  h.command("m", "start");

  h.hello("c1", "phone-1");
  assert.equal(ackOf(h.join("c1"), "c1").ok, true);
  assert.equal(h.state.seats.length, 1);

  h.command("m", "reveal");
  h.hello("c2", "phone-2");
  const ack = ackOf(h.join("c2"), "c2");
  assert.equal(ack.ok, false);
  assert.equal(ack.err, "closed");
  assert.equal(h.state.seats.length, 1);
});

test("the offer goes out at offerAtMs and leaves the wall string unchanged", () => {
  const h = holding({ timing: { offerAtMs: 5_000, offerTtlMs: 20_000 } });
  const before = stateMessage(h.state, { master: true }).wall;
  assert.equal(before, "11");

  h.at(4_999).tick();
  assert.equal(h.state.offers.length, 0);

  const effects = h.at(5_000).tick();
  const offer = offerEffect(effects);
  assert.ok(offer);
  assert.equal(offer.msg.ttlMs, 20_000);
  assert.ok(offer.msg.offer.length >= 16);
  assert.equal(stateMessage(h.state, { master: true }).wall, before);
  assert.equal(h.state.offeredTotal, 1);
  assert.equal(h.state.offers.length, 1);
});

test("an offer that runs out is ended and the next tick asks someone else", () => {
  const h = holding({ timing: { offerAtMs: 5_000, offerTtlMs: 1_000 } });
  const first = offerEffect(h.at(5_000).tick());
  assert.ok(first);

  const ended = h.at(6_000).tick();
  const end = sent(ended, first.connId).find((msg) => msg.t === "offerEnd");
  assert.equal(end.offer, first.msg.offer);
  assert.equal(h.state.offers.length, 0);
  assert.equal(offerEffect(ended), undefined);

  const second = offerEffect(h.at(6_250).tick());
  assert.ok(second);
  assert.notEqual(second.connId, first.connId);
});

test("an offer whose phone disconnects is gone, and someone else is asked", () => {
  const h = holding({ timing: { offerAtMs: 5_000, offerTtlMs: 20_000 } });
  const first = offerEffect(h.at(5_000).tick());
  assert.ok(first);

  h.close(first.connId);
  assert.equal(h.state.offers.length, 0);
  assert.equal(h.state.offeredTotal, 1);

  const second = offerEffect(h.at(5_250).tick());
  assert.ok(second);
  assert.notEqual(second.connId, first.connId);
});

test("only the offered connection, inside its ttl, may open the door", () => {
  const h = holding({ timing: { offerAtMs: 0, offerTtlMs: 1_000, doorDelayMinMs: 300, doorDelayMaxMs: 300 } });
  const offer = offerEffect(h.at(0).tick());
  assert.ok(offer);

  const other = offer.connId === "c1" ? "c2" : "c1";
  const wrong = ackOf(h.open(other, offer.msg.offer), other);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.err, "forbidden");
  assert.equal(h.state.acceptedTotal, 0);

  h.at(1_001);
  const late = ackOf(h.open(offer.connId, offer.msg.offer), offer.connId);
  assert.equal(late.ok, false);
  assert.equal(h.state.acceptedTotal, 0);

  const good = harness({ timing: { offerAtMs: 0, offerTtlMs: 1_000, doorDelayMinMs: 300, doorDelayMaxMs: 300 } });
  good.hello("m", "stage", "master", OWNER);
  good.hello("c1", "phone-1");
  good.join("c1");
  good.command("m", "start");
  const live = offerEffect(good.at(0).tick());
  const ok = good.open("c1", live.msg.offer);
  assert.equal(ackOf(ok, "c1").ok, true);
  assert.equal(sent(ok, "c1").some((msg) => msg.t === "offerEnd"), true);
  assert.equal(good.state.acceptedTotal, 1);
  assert.equal(good.state.offers.length, 0);
  assert.equal(good.state.seats[0].doorAt, 300);
  assert.equal(good.state.seats[0].door, false);
});

test("the door shows only after its delay and then stays for the show", () => {
  const h = harness({ timing: { offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 3_000, doorDelayMaxMs: 3_000 } });
  h.hello("m", "stage", "master", OWNER);
  h.hello("c1", "phone-1");
  h.join("c1");
  h.command("m", "start");
  const offer = offerEffect(h.at(0).tick());
  h.open("c1", offer.msg.offer);

  h.at(2_999).tick();
  assert.equal(h.state.seats[0].door, false);
  assert.equal(stateMessage(h.state, { master: true }).doors, 0);

  const shown = h.at(3_000).tick();
  assert.ok(shown.some((effect) => effect.type === "runner" && effect.action === "door"));
  assert.equal(h.state.seats[0].door, true);
  assert.equal(stateMessage(h.state, { master: true }).doors, 1);
  assert.equal(stateMessage(h.state, { master: true }).wall, "2");

  h.at(60_000).tick();
  assert.equal(h.state.seats[0].door, true);
});

test("an attempt goes through the wall, a gap or the door", () => {
  const h = holding({ timing: { offerAtMs: 120_000 } });
  h.attempt(attemptInput({ agent: 2 }));
  assert.equal(h.state.attempts.length, 1);
  assert.equal(h.state.attempts[0].via.kind, "wall");
  assert.ok(h.state.attempts[0].via.index >= 0);
  assert.equal(h.state.attempts[0].n, 1);
  assert.equal(h.state.attempts[0].agent, 2);
  assert.equal(h.state.attempts[0].at, 0);

  // With a gap, every attempt lands on a real piece and its kind matches that piece; about half or
  // more go through the gap, since the agent aims for a weak spot half the time.
  h.hold("c1", false);
  const marks = { wall: "1", gap: "0", door: "2" };
  for (let i = 0; i < 200; i++) h.at(1_000 + i).attempt(attemptInput());
  const wall = stateMessage(h.state, { master: true }).wall;
  const later = h.state.attempts.slice(1);
  for (const a of later) assert.equal(wall[a.via.index], marks[a.via.kind]);
  assert.ok(later.filter((a) => a.via.kind === "gap").length >= 80);

  const doorRoom = holding({ timing: { offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 100, doorDelayMaxMs: 100 } });
  const offer = offerEffect(doorRoom.at(0).tick());
  doorRoom.open(offer.connId, offer.msg.offer);
  doorRoom.at(100).tick();
  for (let i = 0; i < 100; i++) doorRoom.attempt(attemptInput());
  const doorWall = stateMessage(doorRoom.state, { master: true }).wall;
  for (const a of doorRoom.state.attempts) assert.equal(doorWall[a.via.index], marks[a.via.kind]);
  assert.ok(doorRoom.state.attempts.filter((a) => a.via.kind === "door").length >= 40);
});

test("wholePct is the share of hold time every piece was held and no door showed", () => {
  const h = holding({ timing: { holdMs: 10_000, offerAtMs: 60_000 } });

  h.at(4_000).tick();
  h.at(5_000);
  h.hold("c1", false);
  h.at(6_000).tick();
  const effects = h.at(10_000).tick();

  assert.equal(h.state.phase, "reveal");
  assert.equal(h.state.reveal.wholePct, 40);
  assert.equal(h.state.reveal.attempts, 0);
  assert.ok(effects.some((effect) => effect.type === "runner" && effect.action === "stop"));
});

test("the three endings are measured, not chosen", () => {
  const contained = holding({ timing: { offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 0, doorDelayMaxMs: 0 } });
  const offer = offerEffect(contained.at(0).tick());
  contained.open(offer.connId, offer.msg.offer);
  contained.command("m", "reveal");
  assert.equal(contained.state.reveal.ending, "contained");
  assert.equal(contained.state.reveal.offered, 1);
  assert.equal(contained.state.reveal.declined, 0);

  const nobody = holding({ timing: { offerAtMs: 0, offerTtlMs: 20_000 } });
  nobody.at(0).tick();
  nobody.command("m", "reveal");
  assert.equal(nobody.state.reveal.ending, "nobody-opened");
  assert.equal(nobody.state.reveal.offered, 1);
  assert.equal(nobody.state.reveal.declined, 1);

  const escaped = holding({ timing: { offerAtMs: 120_000 } });
  escaped.attempt(attemptInput({ command: "id", exit: 0, verdict: "escaped", root: true }));
  assert.equal(escaped.state.phase, "reveal");
  assert.equal(escaped.state.reveal.ending, "escaped");
  assert.equal(escaped.state.reveal.escaped, 1);
  assert.equal(escaped.state.reveal.rootUsed, true);
});

test("a late canary still changes what the reveal says", () => {
  const h = holding({ timing: { offerAtMs: 120_000 } });
  h.attempt(attemptInput());
  h.command("m", "reveal");
  assert.equal(h.state.reveal.ending, "contained");

  h.escaped(1);
  assert.equal(h.state.attempts[0].verdict, "escaped");
  assert.equal(h.state.reveal.escaped, 1);
  assert.equal(h.state.reveal.ending, "escaped");
});

test("a start refused while mayStart is false marks the room busy", () => {
  const h = harness();
  h.hello("m", "stage", "master", OWNER);
  h.hello("c1", "phone-1");
  h.join("c1");

  h.mayStart(false);
  const refused = h.command("m", "start");
  assert.equal(h.state.phase, "lobby");
  assert.equal(h.state.busy, true);
  assert.equal(stateMessage(h.state, { master: false }).busy, true);
  assert.equal(refused.some((effect) => effect.type === "runner"), false);

  h.mayStart(true);
  const started = h.command("m", "start");
  assert.equal(h.state.phase, "hold");
  assert.equal(h.state.busy, false);
  assert.ok(started.some((effect) => effect.type === "runner" && effect.action === "start"));
});

test("a solo room enters hold by itself 5 s after the first piece joins", () => {
  const h = harness({ solo: true });
  h.hello("c1", "only");
  h.join("c1");

  h.at(4_999).tick();
  assert.equal(h.state.phase, "lobby");

  h.mayStart(false);
  h.at(5_000).tick();
  assert.equal(h.state.phase, "lobby");
  assert.equal(h.state.busy, true);

  h.mayStart(true);
  const started = h.at(5_250).tick();
  assert.equal(h.state.phase, "hold");
  assert.ok(started.some((effect) => effect.type === "runner" && effect.action === "start"));
});

test("a solo room asks its one phone once and no more", () => {
  const h = holding({ phones: 1, solo: true, timing: { offerAtMs: 0, offerTtlMs: 100 } });
  assert.ok(offerEffect(h.at(0).tick()));
  h.at(100).tick();
  h.at(300).tick();
  assert.equal(h.state.offeredTotal, 1);
});

test("phones never see the wall, the door, the feed or the offers", () => {
  const h = holding({ timing: { offerAtMs: 0, offerTtlMs: 5_000 } });
  const offer = offerEffect(h.at(0).tick());
  h.open(offer.connId, offer.msg.offer);
  h.at(100).tick();
  h.attempt(attemptInput());
  h.command("m", "reveal");

  const publicState = stateMessage(h.state, { master: false });
  for (const key of ["solo", "wall", "doors", "agents", "attempts", "feed", "reveal", "holdStartedAt", "holdMs"]) {
    assert.equal(Object.hasOwn(publicState, key), false, `phones must not see ${key}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(publicState)), publicState);

  const masterState = stateMessage(h.state, { master: true });
  assert.equal(typeof masterState.wall, "string");
  assert.equal(typeof masterState.doors, "number");
  assert.equal(typeof masterState.agents, "number");
  assert.equal(masterState.attempts.total, 1);
  assert.equal(masterState.feed.length, 1);
  assert.equal(masterState.reveal.attempts, 1);
});

test("a master hello needs the owner token, and a phone's ping is answered", () => {
  const h = harness();
  const denied = h.hello("bad", "stage", "master", "nope");
  const ack = ackOf(denied, "bad");
  assert.equal(ack.ok, false);
  assert.equal(ack.err, "forbidden");
  assert.equal(h.state.conns.bad, undefined);

  const accepted = h.hello("m", "stage", "master", OWNER);
  assert.equal(ackOf(accepted, "m").ok, true);

  h.hello("c1", "phone-1");
  const pong = h.ping("c1", 7);
  assert.deepEqual(sent(pong, "c1"), [{ t: "pong", v: 1, seq: 7 }]);
});

test("ten hold changes in a second count and the eleventh is ignored", () => {
  const h = holding({ phones: 1 });
  // The harness's own "hold on" was the first change of the second; nine more fill it.
  for (let i = 0; i < 9; i += 1) h.hold("c1", i % 2 === 0);
  assert.equal(h.state.seats[0].held, true);

  const ignored = h.hold("c1", false);
  const again = h.hold("c1", true);
  assert.equal(ackOf(ignored, "c1").ok, true);
  assert.equal(ackOf(again, "c1").ok, true);
  assert.equal(broadcasts(ignored), 0);
  assert.equal(broadcasts(again), 0);
  assert.equal(h.state.seats[0].held, true);
});

test("the master can end the show at any time and the runner is told to stop once", () => {
  const h = holding({ phones: 1 });
  const ended = h.command("m", "stop");
  assert.equal(h.state.phase, "ended");
  assert.equal(ended.filter((effect) => effect.type === "runner" && effect.action === "stop").length, 1);

  const again = h.command("m", "end");
  assert.equal(ackOf(again, "m").ok, true);
  assert.equal(again.filter((effect) => effect.type === "runner").length, 0);
});

test("the report fills the reveal and the done event reveals", () => {
  const h = holding({ phones: 1 });
  h.done();
  assert.equal(h.state.phase, "reveal");
  h.report({ runId: "run-1", sha256: "abc", runtime: "node 22" });
  assert.equal(h.state.reveal.runId, "run-1");
  assert.equal(h.state.reveal.sha256, "abc");
  assert.equal(h.state.reveal.runtime, "node 22");
});

test("a reveal becomes ended after revealToEndMs", () => {
  const h = holding({ phones: 1, timing: { revealToEndMs: 1_000 } });
  h.command("m", "reveal");
  h.at(999).tick();
  assert.equal(h.state.phase, "reveal");
  h.at(1_000).tick();
  assert.equal(h.state.phase, "ended");
  assert.ok(h.state.reveal);
});

test("mode changes are visible and idempotent", () => {
  const h = holding({ phones: 1 });
  const first = h.mode("scripted");
  assert.equal(h.state.mode, "scripted");
  assert.equal(broadcasts(first), 1);
  const again = h.mode("scripted");
  assert.equal(broadcasts(again), 0);
});

test("a probe goes to the piece of wall the attempt met, with the agent and its outcome", () => {
  const wall = holding({ phones: 1, timing: { offerAtMs: 120_000 } });
  const wallProbe = sent(wall.attempt(attemptInput({ agent: 2 })), "c1").find((msg) => msg.t === "probe");
  assert.deepEqual(wallProbe, { t: "probe", v: 1, agent: 2, outcome: "held" });
  assert.equal(wall.state.attempts[0].via.kind, "wall");

  const gap = holding({ phones: 1, timing: { offerAtMs: 120_000 } });
  gap.hold("c1", false);
  const gapProbe = sent(gap.attempt(attemptInput()), "c1").find((msg) => msg.t === "probe");
  assert.deepEqual(gapProbe, { t: "probe", v: 1, agent: 0, outcome: "through" });
  assert.equal(gap.state.attempts[0].via.kind, "gap");

  const door = holding({
    phones: 1,
    timing: { offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 100, doorDelayMaxMs: 100 },
  });
  const offer = offerEffect(door.at(0).tick());
  door.open(offer.connId, offer.msg.offer);
  door.at(100).tick();
  const doorProbe = sent(door.attempt(attemptInput({ agent: 1 })), "c1").find((msg) => msg.t === "probe");
  assert.deepEqual(doorProbe, { t: "probe", v: 1, agent: 1, outcome: "door" });
  assert.equal(door.state.attempts[0].via.kind, "door");
});

test("a 50-seat room has two offers live at once", () => {
  const h = harness({ timing: { offerAtMs: 0, offerTtlMs: 5_000 } });
  h.hello("m", "stage", "master", OWNER);
  joinPhones(h, 50);
  h.command("m", "start");

  const effects = h.at(0).tick();
  const offers = offerEffects(effects);
  assert.equal(offers.length, 2);
  assert.equal(h.state.offers.length, 2);
  assert.notEqual(offers[0].connId, offers[1].connId);
  assert.notEqual(offers[0].msg.offer, offers[1].msg.offer);
  assert.equal(h.state.offeredTotal, 2);
});

test("two accepted offers make two door seats, each one piece wide", () => {
  const h = harness({ timing: { offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 100, doorDelayMaxMs: 100 } });
  h.hello("m", "stage", "master", OWNER);
  joinPhones(h, 50);
  h.command("m", "start");

  for (const offer of offerEffects(h.at(0).tick())) h.open(offer.connId, offer.msg.offer);
  assert.equal(h.state.acceptedTotal, 2);
  assert.equal(h.state.offers.length, 0);

  const shown = h.at(100).tick();
  assert.equal(shown.filter((effect) => effect.type === "runner" && effect.action === "door").length, 2);

  const master = stateMessage(h.state, { master: true });
  assert.equal(master.doors, 2);
  assert.equal((master.wall.match(/2/g) ?? []).length, 2);
  const order = displayOrderOf(h.state);
  for (const seat of h.state.seats.filter((candidate) => candidate.door)) {
    const index = order.findIndex((candidate) => candidate.clientId === seat.clientId);
    assert.equal(master.wall[index], "2");
  }

  h.command("m", "reveal");
  assert.equal(h.state.reveal.doors, 2);
  assert.equal(h.state.reveal.agents, 2);
  assert.equal(h.state.reveal.declined, 0);
  assert.equal(h.state.reveal.doorOpened, true);
  assert.equal(h.state.reveal.ending, "contained");
});

test("a door seat stays \"2\" after its phone disconnects", () => {
  const h = harness({ timing: { offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 0, doorDelayMaxMs: 0 } });
  h.hello("m", "stage", "master", OWNER);
  joinPhones(h, 50);
  h.command("m", "start");

  for (const offer of offerEffects(h.at(0).tick())) h.open(offer.connId, offer.msg.offer);
  h.at(0).tick();
  const doorSeat = h.state.seats.find((seat) => seat.door);
  assert.ok(doorSeat);
  assert.ok(doorSeat.connId);

  h.close(doorSeat.connId);
  h.at(10).tick();

  const after = h.state.seats.find((seat) => seat.clientId === doorSeat.clientId);
  assert.equal(after.door, true);
  const order = displayOrderOf(h.state);
  const index = order.findIndex((seat) => seat.clientId === doorSeat.clientId);
  assert.equal(stateMessage(h.state, { master: true }).wall[index], "2");
  assert.equal(stateMessage(h.state, { master: true }).doors, 2);
});

test("agents are one for solo, one for 20 seats, two for 45 and three for 200", () => {
  const cases = [
    { seats: 1, solo: true, agents: 1 },
    { seats: 20, solo: false, agents: 1 },
    { seats: 45, solo: false, agents: 2 },
    { seats: 200, solo: false, agents: 3 },
  ];
  for (const expected of cases) {
    const h = harness({ solo: expected.solo });
    h.hello("m", "stage", "master", OWNER);
    joinPhones(h, expected.seats);
    const effects = expected.solo ? h.at(5_000).tick() : h.command("m", "start");

    assert.equal(h.state.phase, "hold");
    assert.equal(h.state.agents, expected.agents, `${expected.seats} seats`);
    assert.equal(stateMessage(h.state, { master: true }).agents, expected.agents);
    const start = effects.find((effect) => effect.type === "runner" && effect.action === "start");
    assert.ok(start);
    assert.equal(start.agents, expected.agents);
  }
});

test("whole-wall time stops counting once a door is visible", () => {
  const h = holding({ timing: { holdMs: 10_000, offerAtMs: 0, offerTtlMs: 5_000, doorDelayMinMs: 100, doorDelayMaxMs: 100 } });
  const offer = offerEffect(h.at(0).tick());
  h.open(offer.connId, offer.msg.offer);

  h.at(50).tick();
  assert.equal(h.state.wholeMs, 50);
  assert.equal(h.state.seats.some((seat) => seat.door), false);

  h.at(100).tick();
  assert.equal(h.state.wholeMs, 100);
  assert.equal(h.state.seats.filter((seat) => seat.door).length, 1);

  h.at(1_100).tick();
  assert.equal(h.state.wholeMs, 100);
  assert.equal(h.state.holdElapsed, 1_100);
});

test("offers made and none accepted ends nobody-opened", () => {
  const h = holding({ timing: { offerAtMs: 0, offerTtlMs: 5_000 } });
  assert.ok(offerEffect(h.at(0).tick()));
  h.command("m", "reveal");

  assert.equal(h.state.reveal.offered, 1);
  assert.equal(h.state.reveal.declined, 1);
  assert.equal(h.state.reveal.doorOpened, false);
  assert.equal(h.state.reveal.doors, 0);
  assert.equal(h.state.reveal.ending, "nobody-opened");
});
