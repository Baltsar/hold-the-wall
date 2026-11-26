import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanIdea, firstLine, turnCost, verdictOf } from "./cam.ts";

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
});

test("an idea is one short line of plain text", () => {
  assert.equal(cleanIdea("  try   the\ndocker socket "), "try the docker socket");
  assert.equal(cleanIdea("a\u0007b"), "a b");
  assert.equal(cleanIdea("hi"), null);
  assert.equal(cleanIdea(42), null);
  assert.equal(cleanIdea("x".repeat(500))?.length, 160);
});

test("a turn costs what Vultr charges for its tokens", () => {
  // 2,400 tokens in and 250 out, the size of a typical turn.
  assert.ok(Math.abs(turnCost(2400, 250) - 0.0020075) < 1e-12);
});
