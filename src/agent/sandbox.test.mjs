import { test } from "node:test";
import assert from "node:assert/strict";
import { runFlags } from "./sandbox.ts";

test("a box has no network unless it is loosened", () => {
  const flags = runFlags("runsc");
  assert.equal(flags[flags.indexOf("--network") + 1], "none");
  assert.ok(!flags.includes("--add-host"));
});

test("a box given the outside network gets the outside's name in /etc/hosts", () => {
  const flags = runFlags("runsc", { network: "wall-outside", hosts: { outside: "172.19.0.1" } });
  assert.equal(flags[flags.indexOf("--network") + 1], "wall-outside");
  assert.equal(flags[flags.indexOf("--add-host") + 1], "outside:172.19.0.1");
});
