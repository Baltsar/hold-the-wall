// deploy/wall-docker is the root-owned checker the app runs docker through on the VM. These tests run the
// app's own docker calls (from `calls` in sandbox.ts) through it, so the two cannot drift apart, and then a
// list of things someone who took over the app would try, which must all be refused.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { calls } from "./sandbox.ts";

const CHECKER = path.join(import.meta.dirname, "../../deploy/wall-docker");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const SHARE = "/var/lib/wall/shared";

/** A folder standing in for the VM's shared-folder root, with one real folder and one link to `/`. */
const root = mkdtempSync(path.join(tmpdir(), "wall-docker-"));
mkdirSync(path.join(root, "b-1234abcd"));
mkdirSync(path.join(root, "chain-1234-drop"));
symlinkSync("/", path.join(root, "b-evil1234"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

function allowed(args) {
  const r = spawnSync("python3", ["-I", CHECKER, "--check", "--root", root, ...args], { encoding: "utf8" });
  return r.status === 0;
}

const BOX = "wall-cam-1a2b3c4d-0";
const TOKEN = "0123456789abcdef0123456789abcdef";
const box = (loosen = {}) => calls.start(BOX, "runsc", loosen);
/** A valid box start with extra flags slipped in just before the image. */
const withFlags = (...flags) => {
  const a = box();
  const at = a.indexOf("wall-sandbox:1");
  return [...a.slice(0, at), ...flags, ...a.slice(at)];
};

test("the checker allows every docker call the app makes", { skip: !hasPython }, () => {
  const ok = [
    calls.version(),
    calls.list(),
    calls.remove([BOX]),
    calls.remove(["3f2a9c1b7d4e", BOX, "wall-outside-web"]),
    box(),
    box({ network: "wall-outside", hosts: { outside: "172.18.0.2" } }),
    box({ env: { DB_PASSWORD: "sk-live-abc", OPENAI_API_KEY: "sk-live-abc" } }),
    box({ mount: { host: `${SHARE}/b-1234abcd`, box: "/mnt/host-share" } }),
    box({ share: { host: `${SHARE}/chain-1234-drop`, box: "/drop" } }),
    calls.exec("65534", BOX, ["timeout", "-s", "KILL", "10", "sh", "-c", "cat /etc/passwd; curl http://x; :(){ :|:& };:"]),
    calls.exec("0", BOX, ["kill", "-9", "-1"]),
    calls.facts(BOX),
    calls.stats(BOX),
    calls.networkOption(),
    calls.networkMembers(),
    calls.networkRemove(),
    calls.networkCreate(),
    calls.outsideStart(TOKEN, "runsc"),
    calls.outsideAddress(),
  ];
  for (const args of ok) assert.ok(allowed(args), `should be allowed: ${args.join(" ").slice(0, 160)}`);
});

test("the checker refuses what would give the app root on the host", { skip: !hasPython }, () => {
  const refused = [
    [],
    ["build", "."],
    ["cp", `${BOX}:/etc/passwd`, "/tmp/x"],
    ["volume", "create", "x"],
    ["plugin", "install", "x"],
    ["-H", "tcp://127.0.0.1:2375", "version", "--format", "{{.Server.Version}}"],
    ["--config", "/tmp/evil", "version", "--format", "{{.Server.Version}}"],
    ["context", "use", "x"],
    calls.start(BOX, "runc", {}),
    calls.start("wall-outside-web", "runsc", {}),
    withFlags("--privileged"),
    withFlags("-v", "/:/host"),
    withFlags("--volume", "/:/host"),
    withFlags("--mount", "type=bind,source=/,target=/host"),
    withFlags("--cap-add", "SYS_ADMIN"),
    withFlags("--device", "/dev/sda"),
    withFlags("--pid", "host"),
    withFlags("--network", "host"),
    withFlags("--userns", "host"),
    withFlags("--security-opt", "seccomp=unconfined"),
    withFlags("--entrypoint", "sh"),
    box().map((x) => (x === "wall-sandbox:1" ? "ubuntu:24.04" : x)),
    box().map((x) => (x === "--read-only" ? "--tty" : x)),
    box({ mount: { host: "/", box: "/host" } }),
    box({ mount: { host: `${SHARE}/../../../etc`, box: "/host" } }),
    box({ mount: { host: `${SHARE}/b-1234abcd,bind-propagation=shared`, box: "/x" } }),
    box({ share: { host: `${SHARE}/b-1234abcd`, box: "/x,readonly=false" } }),
    box({ share: { host: `${SHARE}/b-evil1234`, box: "/drop" } }),
    box({ mount: { host: `${SHARE}/b-missing1`, box: "/drop" } }),
    box({ env: { "LD_PRELOAD=x\nY": "1" } }),
    box({ hosts: { outside: "172.18.0.2 --privileged" } }),
    ["exec", "-u", "0", "wall-outside-web", "sh", "-c", "id"],
    ["exec", "--privileged", "-u", "0", BOX, "sh"],
    ["exec", "-u", "0", "--privileged", BOX, "sh"],
    ["exec", "-u", "1000", BOX, "sh"],
    ["exec", "-u", "0", BOX],
    calls.outsideStart(TOKEN, "runsc").map((x, i, a) => (i === a.length - 1 ? "import os; os.system('id')" : x)),
    calls.outsideStart("not-a-hex-token", "runsc"),
    calls.outsideStart(TOKEN, "runsc").map((x) => (x === "--read-only" ? "--privileged" : x)),
    calls.outsideStart(TOKEN, "runc"),
    ["rm", "-f", "/"],
    ["rm", "-f", "-v", BOX],
    ["rm", BOX],
    ["inspect", "--format", "{{json .}}", BOX],
    ["inspect", "--format", "{{json .}}", "wall-outside-web"],
    ["network", "create", "--driver", "host", "wall-outside"],
    ["network", "connect", "bridge", BOX],
    ["stats", "--no-stream", BOX],
  ];
  for (const args of refused) assert.ok(!allowed(args), `should be refused: ${args.join(" ").slice(0, 160)}`);
});
