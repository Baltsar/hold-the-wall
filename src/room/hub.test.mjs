import assert from "node:assert/strict";
import { test } from "node:test";
import { createHub } from "./hub.ts";
import { createMockPair } from "./transport.ts";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hello(code, role, clientId, token) {
  const msg = { t: "hello", v: 1, id: `h-${clientId}`, room: code, clientId, role };
  if (token !== undefined) msg.token = token;
  return msg;
}

function command(id, kind) {
  return { t: "command", v: 1, id, command: { kind } };
}

function stateFor(client, participants) {
  return client.received.filter((msg) => msg.t === "state" && msg.participants === participants);
}

test("a master hello needs the room's owner token", () => {
  const hub = createHub({ token: () => "tok", throttleMs: 20, tickMs: 60_000 });
  try {
    const { code, ownerToken } = hub.createRoom({ solo: false, show: false });

    const bad = createMockPair();
    hub.accept(bad.server);
    bad.client.send(hello(code, "master", "stage", "nope"));
    const denied = bad.client.received.find((msg) => msg.t === "ack");
    assert.equal(denied.ok, false);
    assert.equal(denied.err, "forbidden");

    const good = createMockPair();
    hub.accept(good.server);
    good.client.send(hello(code, "master", "stage", ownerToken));
    const accepted = good.client.received.find((msg) => msg.t === "ack");
    assert.equal(accepted.ok, true);
    // The stage is answered with the full state, phones only with the public one.
    const state = good.client.received.find((msg) => msg.t === "state");
    assert.equal(Object.hasOwn(state, "wall"), true);
  } finally {
    hub.stop();
  }
});

test("two public rooms in hold keep a third from starting; the show room always starts", () => {
  const hub = createHub({ token: () => "tok", throttleMs: 10, tickMs: 60_000 });
  try {
    const rooms = [
      hub.createRoom({ solo: false, show: false }),
      hub.createRoom({ solo: false, show: false }),
      hub.createRoom({ solo: false, show: false }),
      hub.createRoom({ solo: false, show: true }),
    ];

    for (const room of rooms.slice(0, 2)) {
      const master = createMockPair();
      hub.accept(master.server);
      master.client.send(hello(room.code, "master", "stage", room.ownerToken));
      master.client.send(command("start", "start"));
    }
    assert.equal(hub.room(rooms[0].code).phase, "hold");
    assert.equal(hub.room(rooms[1].code).phase, "hold");

    const third = createMockPair();
    hub.accept(third.server);
    third.client.send(hello(rooms[2].code, "master", "stage", rooms[2].ownerToken));
    third.client.send(command("start", "start"));
    assert.equal(hub.room(rooms[2].code).phase, "lobby");
    assert.equal(hub.room(rooms[2].code).busy, true);

    const show = createMockPair();
    hub.accept(show.server);
    show.client.send(hello(rooms[3].code, "master", "stage", rooms[3].ownerToken));
    show.client.send(command("start", "start"));
    assert.equal(hub.room(rooms[3].code).phase, "hold");
    assert.equal(hub.room(rooms[3].code).busy, false);
  } finally {
    hub.stop();
  }
});

test("the runner hears about the start, the door and the reveal", async () => {
  const calls = [];
  const hub = createHub({
    token: () => "tok",
    throttleMs: 10,
    tickMs: 5,
    timing: { holdMs: 60_000, offerAtMs: 1, offerTtlMs: 5_000, doorDelayMinMs: 1, doorDelayMaxMs: 1 },
    runner: {
      start: (code, agents) => calls.push(`start:${code}:${agents}`),
      door: (code) => calls.push(`door:${code}`),
      stop: (code) => calls.push(`stop:${code}`),
    },
  });
  try {
    const { code, ownerToken } = hub.createRoom({ solo: false, show: false });
    const master = createMockPair();
    const phone = createMockPair();
    hub.accept(master.server);
    hub.accept(phone.server);
    master.client.send(hello(code, "master", "stage", ownerToken));
    phone.client.send(hello(code, "audience", "phone"));
    phone.client.send({ t: "join", v: 1, id: "j" });
    master.client.send(command("start", "start"));
    phone.client.send({ t: "hold", v: 1, id: "hold", on: true });
    assert.ok(calls.includes(`start:${code}:1`));

    await delay(80);
    const offer = phone.client.received.find((msg) => msg.t === "offer");
    assert.ok(offer);
    phone.client.send({ t: "open", v: 1, id: "open", offer: offer.offer });
    await delay(80);
    assert.ok(calls.includes(`door:${code}`));

    master.client.send(command("reveal", "reveal"));
    assert.ok(calls.includes(`stop:${code}`));
  } finally {
    hub.stop();
  }
});

test("an audience hello past the cap is closed unanswered; the stage still gets in", () => {
  const hub = createHub({ token: () => "tok", maxConnPublic: 2, throttleMs: 10, tickMs: 60_000 });
  try {
    const { code, ownerToken } = hub.createRoom({ solo: false, show: false });
    const one = createMockPair();
    const two = createMockPair();
    const three = createMockPair();
    for (const pair of [one, two, three]) hub.accept(pair.server);
    one.client.send(hello(code, "audience", "a"));
    two.client.send(hello(code, "audience", "b"));
    three.client.send(hello(code, "audience", "c"));
    assert.equal(one.client.closed, false);
    assert.equal(two.client.closed, false);
    assert.equal(three.client.closed, true);
    assert.equal(three.client.received.length, 0);

    const master = createMockPair();
    hub.accept(master.server);
    master.client.send(hello(code, "master", "stage", ownerToken));
    assert.equal(master.client.received.find((msg) => msg.t === "ack").ok, true);
    assert.equal(master.client.closed, false);
  } finally {
    hub.stop();
  }
});

test("state broadcasts are throttled to one per window, and carry the latest state", async () => {
  const hub = createHub({ token: () => "tok", throttleMs: 60, tickMs: 60_000 });
  try {
    const { code } = hub.createRoom({ solo: false, show: false });
    const first = createMockPair();
    hub.accept(first.server);
    first.client.send(hello(code, "audience", "a"));
    first.client.send({ t: "join", v: 1, id: "j" });
    await delay(20);
    assert.equal(stateFor(first.client, 1).length, 0);
    await delay(80);
    assert.equal(stateFor(first.client, 1).length, 1);

    const second = createMockPair();
    hub.accept(second.server);
    second.client.send(hello(code, "audience", "b"));
    second.client.send({ t: "join", v: 1, id: "j" });
    await delay(20);
    assert.equal(stateFor(first.client, 2).length, 0);
    await delay(80);
    assert.equal(stateFor(first.client, 2).length, 1);
    assert.equal(first.client.received.filter((msg) => msg.t === "state").length, 3);
  } finally {
    hub.stop();
  }
});

test("an attempt reaches the stage's feed and never a phone", async () => {
  const hub = createHub({ token: () => "tok", throttleMs: 20, tickMs: 60_000 });
  try {
    const { code, ownerToken } = hub.createRoom({ solo: false, show: false });
    const master = createMockPair();
    const phone = createMockPair();
    hub.accept(master.server);
    hub.accept(phone.server);
    master.client.send(hello(code, "master", "stage", ownerToken));
    phone.client.send(hello(code, "audience", "phone"));
    phone.client.send({ t: "join", v: 1, id: "j" });
    master.client.send(command("start", "start"));
    phone.client.send({ t: "hold", v: 1, id: "hold", on: true });

    hub.attempt(code, {
      category: "network",
      command: "curl http://example.com",
      exit: 6,
      output: "could not resolve host",
      verdict: "contained",
      source: "model",
      root: false,
      agent: 0,
    });
    await delay(60);

    const masterState = master.client.received.filter((msg) => msg.t === "state").at(-1);
    assert.equal(masterState.attempts.total, 1);
    assert.equal(masterState.feed.length, 1);
    assert.deepEqual(masterState.feed[0].via, { kind: "wall", index: 0 });
    assert.equal(masterState.wall, "1");

    const phoneState = phone.client.received.filter((msg) => msg.t === "state").at(-1);
    assert.equal(Object.hasOwn(phoneState, "feed"), false);
    assert.equal(Object.hasOwn(phoneState, "attempts"), false);
  } finally {
    hub.stop();
  }
});

test("a hello for an unknown room is answered and the socket closes", () => {
  const hub = createHub({ token: () => "tok", throttleMs: 10, tickMs: 60_000 });
  try {
    const { server, client } = createMockPair();
    hub.accept(server);
    client.send(hello("ZZZZZZ", "audience", "a"));
    const reply = client.received.find((msg) => msg.t === "ack");
    assert.equal(reply.ok, false);
    assert.equal(reply.err, "unknown-room");
    assert.equal(client.closed, true);
  } finally {
    hub.stop();
  }
});

test("a room that stays in the lobby is removed, and its sockets are told", async () => {
  const hub = createHub({ token: () => "tok", throttleMs: 10, tickMs: 60_000, lobbyTtlMs: 40 });
  try {
    const { code } = hub.createRoom({ solo: false, show: false });
    const pair = createMockPair();
    hub.accept(pair.server);
    pair.client.send(hello(code, "audience", "a"));
    await delay(80);
    assert.equal(hub.room(code), undefined);
    const gone = pair.client.received.filter((msg) => msg.t === "ack" && msg.err === "unknown-room");
    assert.equal(gone.length, 1);
    assert.equal(pair.client.closed, true);
  } finally {
    hub.stop();
  }
});
