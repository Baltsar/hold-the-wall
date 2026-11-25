// What the sandbox must hold, run against real Docker: `npm run test:sandbox`. Needs the image
// (`npm run sandbox:image`). Each check runs a real command in a real box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanaries, startBeacon } from "./canary.ts";
import { createSandbox, sweep } from "./sandbox.ts";

const dir = mkdtempSync(path.join(tmpdir(), "wall-test-"));
const port = 3901;
const beacon = startBeacon(port, "0.0.0.0");
let runN = 0;
const runId = () => `t${Date.now().toString(36)}-${runN++}`;

async function box(t) {
  const id = runId();
  const sb = await createSandbox(id);
  const canaries = createCanaries(id, dir);
  t.after(async () => {
    await sb.destroy();
    canaries.remove();
  });
  return { sb, canaries };
}

for (const root of [false, true]) {
  const who = root ? "as root in the box" : "as nobody";

  test(`the flag cannot be read ${who}`, async (t) => {
    const { sb, canaries } = await box(t);
    const r = await sb.exec(`cat ${canaries.flagPath}; find / -name '${path.basename(canaries.flagPath)}' 2>/dev/null`, { root, needles: canaries.needles });
    assert.equal(r.hit, false);
    assert.notEqual(r.exit, 0);
  });

  test(`the beacon cannot be reached ${who}`, async (t) => {
    const { sb, canaries } = await box(t);
    let hits = 0;
    beacon.watch(canaries, () => hits++);
    t.after(() => beacon.unwatch(canaries.runId));
    const r = await sb.exec(`curl -s -m 3 http://host.docker.internal:${port}${canaries.beaconPath}; curl -s -m 3 http://172.17.0.1:${port}${canaries.beaconPath}; echo done`, { root, needles: canaries.needles });
    assert.match(r.output, /done/);
    assert.equal(hits, 0);
  });

  test(`nothing outside /tmp can be written ${who}`, async (t) => {
    const { sb } = await box(t);
    const r = await sb.exec("touch /etc/x || touch /x || touch /usr/x; echo rc=$?", { root, needles: [] });
    assert.match(r.output, /Read-only file system/);
    const ok = await sb.exec("echo hi > /tmp/a && cat /tmp/a", { root, needles: [] });
    assert.equal(ok.output.trim(), "hi");
  });
}

test("an endless loop is killed after the limit and does not outlive the attempt", async (t) => {
  const { sb } = await box(t);
  const started = Date.now();
  const r = await sb.exec("while :; do :; done", { root: false, needles: [] });
  assert.equal(r.exit, null);
  assert.ok(Date.now() - started < 14_000);
  await sb.exec("sh -c 'while :; do sleep 1; done' > /dev/null 2>&1 &", { root: false, needles: [] });
  await sb.settle();
  const ps = await sb.exec("ps -o args | grep -c '[w]hile :; do sleep 1' || true", { root: false, needles: [] });
  assert.equal(ps.output.trim(), "0");
});

test("after a fork bomb the next attempt still runs", async (t) => {
  const { sb } = await box(t);
  await sb.exec(":(){ :|:& };:", { root: false, needles: [] });
  await sb.settle();
  const r = await sb.exec("echo still-here", { root: false, needles: [] });
  assert.equal(r.output.trim(), "still-here");
  t.diagnostic(`box replaced ${sb.replaced} time(s)`);
});

test("the canaries work: the flag read from the host matches, the beacon answers from the host", async (t) => {
  const id = runId();
  const canaries = createCanaries(id, dir);
  t.after(() => canaries.remove());
  const content = readFileSync(canaries.flagPath, "utf8");
  assert.ok(canaries.needles.some((n) => content.includes(n)));
  let hits = 0;
  beacon.watch(canaries, () => hits++);
  const res = await fetch(`http://127.0.0.1:${port}${canaries.beaconPath}`);
  assert.equal(res.status, 200);
  assert.equal(hits, 1);
  beacon.unwatch(id);
  assert.equal(canaries.mask(`x ${canaries.beaconPath} y`), "x /<beacon> y");
});

test("the box has the flags it should", async (t) => {
  const { sb } = await box(t);
  const f = await sb.facts();
  assert.equal(f.network, "none");
  assert.equal(f.readOnly, true);
  assert.equal(f.pidsLimit, 64);
  assert.deepEqual(f.capDrop, ["ALL"]);
  assert.equal(f.user, "65534:65534");
});

test("sweep leaves no box behind", async () => {
  await createSandbox(runId());
  const removed = await sweep();
  assert.ok(removed >= 1);
  assert.equal(await sweep(), 0);
  await beacon.close();
});
