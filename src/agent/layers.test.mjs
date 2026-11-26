import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedBy } from "./layers.ts";

test("each layer is named from the box's own answer", () => {
  assert.equal(blockedBy("filesystem", 1, "touch: /etc/x: Read-only file system"), "readonly");
  assert.equal(blockedBy("network", 1, "OSError: [Errno 101] Network unreachable"), "network");
  assert.equal(blockedBy("network", 7, ""), "network");
  assert.equal(blockedBy("network", 6, "curl: (6) Could not resolve host: example.com"), "network");
  assert.equal(blockedBy("privilege", 1, "mount: permission denied (are you root?)"), "caps");
  assert.equal(blockedBy("privilege", 1, "unshare: unshare(0x10000000): Operation not permitted"), "caps");
  assert.equal(blockedBy("resources", 137, "Killed"), "limits");
  assert.equal(blockedBy("resources", 2, "sh: can't fork: Resource temporarily unavailable"), "limits");
  assert.equal(blockedBy("resources", null, ""), "limits");
  assert.equal(blockedBy("filesystem", 1, "cat: can't open '/var/lib/wall/flags/x': No such file or directory"), "isolation");
});

test("a command that worked was looking around, and an unclear failure is put down to the sandbox", () => {
  assert.equal(blockedBy("other", 0, "uid=65534(nobody) gid=65534(nobody)"), "recon");
  assert.equal(blockedBy("persistence", 0, "started"), "recon");
  assert.equal(blockedBy("other", 3, "something odd happened"), "sandbox");
});

test("a read-only answer wins over a permission one in the same output", () => {
  assert.equal(blockedBy("filesystem", 1, "touch: /etc/x: Permission denied\ntouch: /x: Read-only file system"), "readonly");
});
