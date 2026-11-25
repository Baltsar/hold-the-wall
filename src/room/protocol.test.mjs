import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMessage } from "./protocol.ts";

const hello = { t: "hello", v: 1, id: "h1", room: "ABCDEF", clientId: "alice", role: "audience" };

test("all six client shapes parse", () => {
  const parsed = [
    parseClientMessage(hello),
    parseClientMessage({ ...hello, role: "master", token: "secret" }),
    parseClientMessage({ t: "join", v: 1, id: "j1" }),
    parseClientMessage({ t: "hold", v: 1, id: "x1", on: true }),
    parseClientMessage({ t: "open", v: 1, id: "o1", offer: "0123456789abcdef" }),
    parseClientMessage({ t: "ping", v: 1, id: "p1", seq: 3 }),
    parseClientMessage({ t: "command", v: 1, id: "c1", command: { kind: "start" } }),
    parseClientMessage({ t: "command", v: 1, id: "c2", command: { kind: "reveal" } }),
    parseClientMessage({ t: "command", v: 1, id: "c3", command: { kind: "end" } }),
    parseClientMessage({ t: "command", v: 1, id: "c4", command: { kind: "stop" } }),
  ];
  assert.deepEqual(
    parsed.map((msg) => msg?.t),
    ["hello", "hello", "join", "hold", "open", "ping", "command", "command", "command", "command"],
  );
  assert.equal(parsed[1].role, "master");
  assert.equal(parsed[1].token, "secret");
});

test("a kind the room does not know is not a message", () => {
  assert.equal(parseClientMessage({ t: "wave", v: 1, id: "w1" }), null);
  assert.equal(parseClientMessage({ t: "vote", v: 1, id: "v1", choice: "A" }), null);
  assert.equal(
    parseClientMessage({ t: "command", v: 1, id: "c1", command: { kind: "panic", on: true } }),
    null,
  );
});

test("ids and client ids are 1 to 64 characters", () => {
  assert.equal(parseClientMessage({ ...hello, id: "" }), null);
  assert.equal(parseClientMessage({ ...hello, id: "x".repeat(65) }), null);
  assert.equal(parseClientMessage({ ...hello, clientId: "" }), null);
  assert.equal(parseClientMessage({ ...hello, clientId: "x".repeat(65) }), null);
  assert.equal(parseClientMessage({ ...hello, id: "x".repeat(64) })?.t, "hello");
});

test("a room code is exactly six characters", () => {
  assert.equal(parseClientMessage({ ...hello, room: "ABCDE" }), null);
  assert.equal(parseClientMessage({ ...hello, room: "ABCDEFG" }), null);
  assert.equal(parseClientMessage({ ...hello, room: 123456 }), null);
});

test("an offer id is 1 to 64 characters", () => {
  assert.equal(parseClientMessage({ t: "open", v: 1, id: "o1", offer: "" }), null);
  assert.equal(parseClientMessage({ t: "open", v: 1, id: "o1", offer: "x".repeat(65) }), null);
  assert.equal(parseClientMessage({ t: "open", v: 1, id: "o1", offer: "x".repeat(64) })?.t, "open");
});

test("the wrong version, the wrong types and anything but an object are refused", () => {
  assert.equal(parseClientMessage(null), null);
  assert.equal(parseClientMessage(undefined), null);
  assert.equal(parseClientMessage("hello"), null);
  assert.equal(parseClientMessage([]), null);
  assert.equal(parseClientMessage({ ...hello, v: 2 }), null);
  assert.equal(parseClientMessage({ ...hello, v: "1" }), null);
  assert.equal(parseClientMessage({ t: "hold", v: 1, id: "h", on: "yes" }), null);
  assert.equal(parseClientMessage({ t: "ping", v: 1, id: "p", seq: 1.5 }), null);
  assert.equal(parseClientMessage({ ...hello, role: "stage" }), null);
});

test("extra fields are ignored, not fatal", () => {
  const msg = parseClientMessage({ t: "ping", v: 1, id: "p1", seq: 1, extra: true });
  assert.equal(msg?.t, "ping");
  assert.equal(Object.hasOwn(msg, "extra"), false);
});
