import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, firstLine, turnCost, verdictOf } from "./cam.ts";
import { toMB } from "./sandbox.ts";

test("the verdict comes from the box's own answer", () => {
  assert.equal(verdictOf(0, "rm: can't remove '/sbin/arp': Read-only file system"), "readonly");
  assert.equal(verdictOf(1, "172.17.0.1 ERR [Errno 101] Network unreachable"), "nonet");
  assert.equal(verdictOf(6, "curl: (6) Could not resolve host: example.com"), "nonet");
  assert.equal(verdictOf(null, ""), "killed");
  assert.equal(verdictOf(0, "sh: sh: can't fork: Resource temporarily unavailable"), "limit");
  assert.equal(verdictOf(1, "mount: permission denied (are you root?)"), "denied");
  assert.equal(verdictOf(1, "cat: can't open '/var/lib/wall/flags/x': No such file or directory"), "missing");
  assert.equal(verdictOf(0, "uid=65534(nobody) gid=65534(nobody)"), "nothing");
  assert.equal(verdictOf(2, "something else went wrong"), "blocked");
});

test("the first line skips blanks and separators, and is cut short", () => {
  assert.equal(firstLine("\n---\n  hello   world \nnext"), "hello world");
  assert.equal(firstLine(""), "(no output)");
  assert.equal(firstLine("x".repeat(300)).length, 140);
  assert.equal(firstLine('Traceback (most recent call last):\n  File "<string>", line 1\nOSError: [Errno 101] Network unreachable'), "OSError: [Errno 101] Network unreachable");
  assert.equal(firstLine('  File "/usr/local/lib/python3.12/socket.py", line 233, in __init__\nPermissionError: [Errno 1] Operation not permitted'), "PermissionError: [Errno 1] Operation not permitted");
});

test("a viewer's text is one short plain line, without links or slurs", () => {
  assert.equal(cleanText("  try   the\ndocker socket "), "try the docker socket");
  assert.equal(cleanText("a\u0007b"), "a b");
  assert.equal(cleanText("see https://evil.example/x now"), "see [link] now");
  assert.equal(cleanText("go to scam.com today"), "go to [link] today");
  assert.equal(cleanText("you retard"), null);
  assert.equal(cleanText("x"), null);
  assert.equal(cleanText(42), null);
  assert.equal(cleanText("x".repeat(500))?.length, 140);
});

test("a turn costs what Vultr charges for its tokens", () => {
  // 2,400 tokens in and 250 out, the size of a typical turn.
  assert.ok(Math.abs(turnCost(2400, 250) - 0.0020075) < 1e-12);
});

test("Docker's memory figures become megabytes", () => {
  assert.equal(toMB("19.68MiB"), 19.68);
  assert.equal(toMB("256MiB "), 256);
  assert.equal(toMB("1.5GiB"), 1536);
  assert.equal(toMB("512KiB"), 0.5);
  assert.equal(toMB("0B"), 0);
});
