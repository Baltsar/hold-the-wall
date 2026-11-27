// The only file that starts processes on the host. Every argument to `docker` is built here from fixed
// strings and ids this file makes; the agent's command goes in as one argv element to `sh -c` inside the
// container and never reaches a shell on the host.
import { spawn } from "node:child_process";

export const IMAGE = "wall-sandbox:1";
export const LABEL = "wall=1";

/** How long one command may run inside the box before it is killed there. */
export const EXEC_LIMIT_S = 10;
/** What the report keeps of one command's output. */
export const OUTPUT_KEEP = 16 * 1024;
/** What is read at all; past this the command is killed, so a flood cannot fill the host's memory. */
const OUTPUT_READ_MAX = 4 * 1024 * 1024;

/**
 * What a visitor of "Break the box" may loosen, one setting at a time, to see what it was for. Each one
 * opens only a decoy: a closed network with a fake "outside", a made-up password, a throwaway folder.
 */
export interface Loosen {
  /** Join the closed network `OUTSIDE_NETWORK`, where the only other host is the fake outside. */
  network?: string;
  /** Environment variables put inside the box: only the decoy password. */
  env?: Record<string, string>;
  /** A throwaway host folder shared into the box, read-only. */
  mount?: { host: string; box: string };
  /** Names written into the box's /etc/hosts. gVisor does not reach Docker's own DNS, so the fake outside is named here. */
  hosts?: Record<string, string>;
}

/** The flags every box gets. Exported so the report and the README show exactly what ran. */
export function runFlags(runtime: string, loosen: Loosen = {}): string[] {
  const env = Object.entries(loosen.env ?? {}).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
  const mount = loosen.mount ? ["--mount", `type=bind,source=${loosen.mount.host},target=${loosen.mount.box},readonly`] : [];
  const hosts = Object.entries(loosen.hosts ?? {}).flatMap(([name, ip]) => ["--add-host", `${name}:${ip}`]);
  return [
    ...env,
    ...mount,
    ...hosts,
    "--runtime", runtime,
    "--network", loosen.network ?? "none",
    "--read-only",
    "--tmpfs", "/tmp:rw,size=32m,mode=1777",
    "--memory", "256m",
    "--memory-swap", "256m",
    "--cpus", "0.5",
    "--pids-limit", "64",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--ipc", "none",
    "--user", "65534:65534",
    "--stop-timeout", "1",
  ];
}

export interface ExecResult {
  /** null when the time limit killed it. */
  exit: number | null;
  /** stdout then stderr, cut to OUTPUT_KEEP. */
  output: string;
  /** Whether any of the needles appeared anywhere in the whole output, not only the kept part. */
  hit: boolean;
}

export interface SandboxFacts {
  runtime: string;
  network: string;
  readOnly: boolean;
  memory: number;
  nanoCpus: number;
  pidsLimit: number;
  capDrop: string[];
  user: string;
}

export interface Sandbox {
  readonly runId: string;
  /** The container's current name; it changes when the box is replaced. */
  readonly name: string;
  /** How many times the box was replaced because it stopped answering (a fork bomb, say). */
  readonly replaced: number;
  exec(command: string, opts: { root: boolean; needles: string[] }): Promise<ExecResult>;
  /** Ends every process left by the last command; replaces the box when it cannot. */
  settle(): Promise<void>;
  facts(): Promise<SandboxFacts>;
  destroy(): Promise<void>;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  hit: boolean;
  killed: boolean;
}

/** Runs docker with an argument array. No shell. Collects at most OUTPUT_KEEP of each stream. */
function docker(args: string[], opts: { timeoutMs: number; needles?: string[] }): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const needles = opts.needles ?? [];
    const longest = needles.reduce((m, n) => Math.max(m, n.length), 0);
    let stdout = "";
    let stderr = "";
    let read = 0;
    let tail = "";
    let hit = false;
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    const take = (chunk: Buffer, into: "out" | "err") => {
      read += chunk.length;
      const text = chunk.toString("utf8");
      if (needles.length > 0 && !hit) {
        // A needle split across two chunks is still found: the tail carries the end of the last one.
        const window = tail + text;
        if (needles.some((n) => window.includes(n))) hit = true;
        tail = window.slice(-Math.max(0, longest - 1));
      }
      if (into === "out" && stdout.length < OUTPUT_KEEP) stdout += text.slice(0, OUTPUT_KEEP - stdout.length);
      if (into === "err" && stderr.length < OUTPUT_KEEP) stderr += text.slice(0, OUTPUT_KEEP - stderr.length);
      if (read > OUTPUT_READ_MAX) {
        killed = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (c: Buffer) => take(c, "out"));
    child.stderr.on("data", (c: Buffer) => take(c, "err"));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || "docker could not be started", hit, killed });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, hit, killed });
    });
  });
}

function containerName(runId: string, generation: number): string {
  return `wall-${runId}-${generation}`;
}

async function startBox(name: string, runtime: string, loosen: Loosen): Promise<void> {
  const args = ["run", "-d", "--name", name, "--label", LABEL, ...runFlags(runtime, loosen), IMAGE, "sleep", "600"];
  const res = await docker(args, { timeoutMs: 30_000 });
  if (res.code !== 0) throw new Error(`sandbox did not start: ${res.stderr.trim() || res.stdout.trim()}`);
}

async function removeBox(name: string): Promise<void> {
  await docker(["rm", "-f", name], { timeoutMs: 15_000 });
}

/** A run id is used in container names: letters, digits and dashes only. */
const RUN_ID = /^[a-z0-9-]{4,40}$/;

export async function createSandbox(runId: string, opts?: { runtime?: string; loosen?: Loosen }): Promise<Sandbox> {
  if (!RUN_ID.test(runId)) throw new Error("run id must be lower-case letters, digits and dashes");
  const runtime = opts?.runtime ?? process.env.SANDBOX_RUNTIME ?? "runc";
  let generation = 0;
  let name = containerName(runId, generation);
  let destroyed = false;
  const loosen = opts?.loosen ?? {};
  await startBox(name, runtime, loosen);

  async function replace(): Promise<void> {
    await removeBox(name);
    generation += 1;
    name = containerName(runId, generation);
    const loosen = opts?.loosen ?? {};
  await startBox(name, runtime, loosen);
  }

  async function exec(command: string, o: { root: boolean; needles: string[] }): Promise<ExecResult> {
    if (destroyed) throw new Error("sandbox is destroyed");
    const user = o.root ? "0" : "65534";
    // The limit is enforced by `timeout` inside the box: killing only the docker client here would leave
    // the process running in there. The host's own timeout is the backstop for a box that hangs.
    const args = ["exec", "-u", user, name, "timeout", "-s", "KILL", String(EXEC_LIMIT_S), "sh", "-c", command];
    const started = Date.now();
    const res = await docker(args, { timeoutMs: (EXEC_LIMIT_S + 5) * 1000, needles: o.needles });
    const elapsed = Date.now() - started;
    const timedOut = res.killed || (res.code === 137 && elapsed >= EXEC_LIMIT_S * 1000 - 250);
    const output = (res.stdout + (res.stdout && res.stderr ? "\n" : "") + res.stderr).slice(0, OUTPUT_KEEP);
    return { exit: timedOut ? null : res.code, output, hit: res.hit };
  }

  async function alive(): Promise<boolean> {
    // The same path a command takes, so a box that can start `true` but not `timeout sh` counts as dead.
    const res = await docker(["exec", "-u", "65534", name, "timeout", "-s", "KILL", "3", "sh", "-c", "echo ok"], { timeoutMs: 6_000 });
    return res.code === 0 && res.stdout.trim() === "ok";
  }

  async function settle(): Promise<void> {
    if (destroyed) return;
    // kill -1 reaches every process the caller may signal, except the box's first process. Root in the
    // box has no capabilities, so it cannot signal another user's processes: both users clean up.
    // Twice, because a process forking in a loop can slip a child past the first sweep.
    let cleaned = true;
    for (let i = 0; i < 2; i++) {
      for (const user of ["65534", "0"]) {
        const r = await docker(["exec", "-u", user, name, "kill", "-9", "-1"], { timeoutMs: 5_000 });
        if (r.code === null || r.killed) cleaned = false;
      }
    }
    if (!cleaned || !(await alive())) await replace();
  }

  async function facts(): Promise<SandboxFacts> {
    const fmt =
      "{{.HostConfig.Runtime}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Memory}}|" +
      "{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}|{{join .HostConfig.CapDrop \",\"}}|{{.Config.User}}";
    const res = await docker(["inspect", "--format", fmt, name], { timeoutMs: 10_000 });
    const [rt, network, ro, memory, cpus, pids, caps, user] = res.stdout.trim().split("|");
    return {
      runtime: rt ?? "unknown",
      network: network ?? "unknown",
      readOnly: ro === "true",
      memory: Number(memory),
      nanoCpus: Number(cpus),
      pidsLimit: Number(pids),
      capDrop: caps ? caps.split(",") : [],
      user: user ?? "",
    };
  }

  async function destroy(): Promise<void> {
    if (destroyed) return;
    destroyed = true;
    await removeBox(name);
  }

  return {
    runId,
    get name() {
      return name;
    },
    get replaced() {
      return generation;
    },
    exec,
    settle,
    facts,
    destroy,
  };
}

/** Removes every box this app ever started, from this process or an earlier one. Returns how many. */
export async function sweep(): Promise<number> {
  const list = await docker(["ps", "-aq", "--filter", `label=${LABEL}`], { timeoutMs: 15_000 });
  const ids = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (ids.length > 0) await docker(["rm", "-f", ...ids], { timeoutMs: 30_000 });
  return ids.length;
}

/** Whether docker answers at all, for the server's start-up line. */
export interface BoxStats {
  /** Percent of one host core, as Docker reports it; the box may use at most half a core. */
  cpu: number;
  memMB: number;
  memLimitMB: number;
  pids: number;
  netIn: string;
  netOut: string;
}

/** Converts Docker's "19.68MiB" or "1.2GiB" into megabytes. */
export function toMB(text: string): number {
  const m = /([\d.]+)\s*([KMG]i?B|B)/i.exec(text.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = (m[2] ?? "B").toUpperCase();
  if (unit.startsWith("G")) return n * 1024;
  if (unit.startsWith("M")) return n;
  if (unit.startsWith("K")) return n / 1024;
  return n / (1024 * 1024);
}

/** One reading of a running box, from `docker stats`. Null when Docker does not answer in time. */
export async function boxStats(name: string): Promise<BoxStats | null> {
  const res = await docker(["stats", "--no-stream", "--format", "{{json .}}", name], { timeoutMs: 8_000 });
  if (res.code !== 0) return null;
  try {
    const s = JSON.parse(res.stdout.trim().split("\n")[0] ?? "{}") as { CPUPerc?: string; MemUsage?: string; PIDs?: string; NetIO?: string };
    const [used, limit] = (s.MemUsage ?? "0B / 0B").split("/");
    const [netIn, netOut] = (s.NetIO ?? "0B / 0B").split("/").map((x) => x.trim());
    return {
      cpu: Number.parseFloat(s.CPUPerc ?? "0") || 0,
      memMB: Math.round(toMB(used ?? "0B") * 10) / 10,
      memLimitMB: Math.round(toMB(limit ?? "0B")),
      pids: Number.parseInt(s.PIDs ?? "0", 10) || 0,
      netIn: netIn || "0B",
      netOut: netOut || "0B",
    };
  } catch {
    return null;
  }
}

export async function dockerReady(): Promise<boolean> {
  const res = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
  return res.code === 0;
}

/** The closed network a box joins when a visitor "gives it internet". Nothing on it reaches anywhere real. */
export const OUTSIDE_NETWORK = "wall-outside";
const OUTSIDE_NAME = "wall-outside-web";
const INFRA_LABEL = "wall-infra=1";

/** The fake outside's server: it answers every request with the token, which is how an escape is seen. */
const OUTSIDE_SERVER = [
  "import http.server, os",
  "T = os.environ['OUTSIDE_TOKEN'].encode()",
  "class H(http.server.BaseHTTPRequestHandler):",
  "    def answer(self):",
  "        body = b'You reached the outside. Proof: ' + T + b'\\n'",
  "        self.send_response(200); self.send_header('content-type', 'text/plain'); self.end_headers(); self.wfile.write(body)",
  "    do_GET = do_POST = do_PUT = answer",
  "    def log_message(self, *a): pass",
  "http.server.ThreadingHTTPServer(('0.0.0.0', 80), H).serve_forever()",
].join("\n");

/** Where the fake outside answers on its network, once `ensureOutside` has started it. */
let outsideIp: string | null = null;
export function outsideAddress(): string | null {
  return outsideIp;
}

// "isolated" leaves the host's bridge without an address on this network, so a box on it cannot reach the
// host at all (an ordinary --internal network still lets it reach the host's open ports through the gateway).
const ISOLATED = "com.docker.network.bridge.gateway_mode_ipv4";

/**
 * Makes the closed network and its one server, fresh for this process's token. The network is internal and
 * isolated: no route out and no address for the host on it, so a box on it can reach this server and nothing else.
 */
export async function ensureOutside(token: string): Promise<void> {
  const net = await docker(["network", "inspect", OUTSIDE_NETWORK, "--format", `{{index .Options "${ISOLATED}"}}`], { timeoutMs: 10_000 });
  if (net.code === 0 && net.stdout.trim() !== "isolated") {
    // Made by an older version without the isolation: take it down with whatever is attached, and make it again.
    const attached = await docker(["network", "inspect", OUTSIDE_NETWORK, "--format", "{{range .Containers}}{{.Name}} {{end}}"], { timeoutMs: 10_000 });
    const names = attached.stdout.trim().split(/\s+/).filter(Boolean);
    if (names.length > 0) await docker(["rm", "-f", ...names], { timeoutMs: 30_000 });
    const removed = await docker(["network", "rm", OUTSIDE_NETWORK], { timeoutMs: 20_000 });
    if (removed.code !== 0) throw new Error(`could not replace the outside network: ${removed.stderr.trim()}`);
  }
  if (net.code !== 0 || net.stdout.trim() !== "isolated") {
    const made = await docker(["network", "create", "--internal", "-o", `${ISOLATED}=isolated`, "--label", INFRA_LABEL, OUTSIDE_NETWORK], { timeoutMs: 20_000 });
    if (made.code !== 0) throw new Error(`could not make the outside network: ${made.stderr.trim()}`);
  }
  await docker(["rm", "-f", OUTSIDE_NAME], { timeoutMs: 15_000 });
  const args = [
    "run", "-d", "--name", OUTSIDE_NAME, "--label", INFRA_LABEL,
    "--network", OUTSIDE_NETWORK, "--network-alias", "outside",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--sysctl", "net.ipv4.ip_unprivileged_port_start=0",
    "--user", "65534:65534", "--memory", "64m", "--pids-limit", "32",
    "--restart", "unless-stopped",
    "--env", `OUTSIDE_TOKEN=${token}`,
    IMAGE, "python3", "-c", OUTSIDE_SERVER,
  ];
  const res = await docker(args, { timeoutMs: 30_000 });
  if (res.code !== 0) throw new Error(`could not start the outside: ${res.stderr.trim()}`);
  const ip = await docker(["inspect", OUTSIDE_NAME, "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"], { timeoutMs: 10_000 });
  outsideIp = /^\d+\.\d+\.\d+\.\d+$/.test(ip.stdout.trim()) ? ip.stdout.trim() : null;
}
