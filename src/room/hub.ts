import { DEFAULT_TIMING, createRoom as createEngineRoom, reduce, stateMessage } from "./engine.ts";
import type { AttemptInput, Effect, Env, RoomState, Timing } from "./engine.ts";
import type { RoomEvent } from "./engine.ts";
import { parseClientMessage } from "./protocol.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";
import type { Transport } from "./transport.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** How long a new connection has to say hello, counted from the moment it opens. */
export const HELLO_MS = 15_000;

/** How long a connection may stay silent before the hub closes it. A live phone pings every 3 s. */
export const IDLE_MS = 90_000;

export interface RunnerHooks {
  start(code: string, agents: number): void;
  door(code: string): void;
  stop(code: string): void;
}

export interface HubOptions {
  now?: () => number;
  random?: () => number;
  token?: () => string;
  throttleMs?: number;
  tickMs?: number;
  timing?: Partial<Timing>;
  runner?: RunnerHooks;
  /** How many other public rooms may be in hold at once. */
  publicHoldSlots?: number;
  maxConnPublic?: number;
  maxConnShow?: number;
  /** A room still in lobby is removed this long after it was made. */
  lobbyTtlMs?: number;
  /** A room in ended is removed this long after it ended. */
  endedTtlMs?: number;
}

export interface Hub {
  createRoom(init: { solo: boolean; show: boolean }): { code: string; ownerToken: string };
  accept(transport: Transport): void;
  attempt(code: string, input: AttemptInput): void;
  escaped(code: string, n: number): void;
  mode(code: string, mode: "live" | "scripted"): void;
  done(code: string): void;
  report(code: string, info: { runId: string; sha256: string; runtime: string }): void;
  room(code: string): RoomState | undefined;
  stop(): void;
}

interface Conn {
  id: string;
  transport: Transport;
  code: string | null;
  times: number[];
  dropped: boolean;
  joined: boolean;
  master: boolean;
  idle: ReturnType<typeof setTimeout> | null;
  hello: ReturnType<typeof setTimeout> | null;
}

export function createHub(opts?: HubOptions): Hub {
  const now = opts?.now ?? (() => Date.now());
  const random = opts?.random ?? Math.random;
  const token = opts?.token ?? (() => crypto.randomUUID());
  const throttleMs = opts?.throttleMs ?? 250;
  const tickMs = opts?.tickMs ?? 250;
  const timing: Timing = { ...DEFAULT_TIMING, ...(opts?.timing ?? {}) };
  const runner = opts?.runner;
  const publicHoldSlots = opts?.publicHoldSlots ?? 2;
  const maxConnPublic = opts?.maxConnPublic ?? 20;
  const maxConnShow = opts?.maxConnShow ?? 300;
  const lobbyTtlMs = opts?.lobbyTtlMs ?? 15 * 60_000;
  const endedTtlMs = opts?.endedTtlMs ?? 15 * 60_000;

  const rooms = new Map<string, RoomState>();
  const conns = new Map<string, Conn>();
  const roomConns = new Map<string, Set<string>>();
  const broadcasts = new Map<string, ReturnType<typeof setTimeout>>();
  const lobbyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const endedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let connSeq = 0;

  function createRoom(init: { solo: boolean; show: boolean }): { code: string; ownerToken: string } {
    const code = makeCode(random, (candidate) => rooms.has(candidate));
    const ownerToken = token();
    rooms.set(code, createEngineRoom({ code, ownerToken, solo: init.solo, show: init.show, timing }));
    scheduleLobby(code);
    return { code, ownerToken };
  }

  function accept(transport: Transport): void {
    const conn: Conn = {
      id: `c${++connSeq}`,
      transport,
      code: null,
      times: [],
      dropped: false,
      joined: false,
      master: false,
      idle: null,
      hello: null,
    };
    conns.set(conn.id, conn);
    transport.onMessage((raw) => onRaw(conn, raw));
    transport.onClose(() => drop(conn));
    heard(conn);
    conn.hello = setTimeout(() => conn.transport.close(), HELLO_MS);
    unref(conn.hello);
  }

  function room(code: string): RoomState | undefined {
    return rooms.get(code);
  }

  function attempt(code: string, input: AttemptInput): void {
    apply(code, { type: "attempt", input });
  }

  function escaped(code: string, n: number): void {
    apply(code, { type: "escaped", n });
  }

  function mode(code: string, next: "live" | "scripted"): void {
    apply(code, { type: "mode", mode: next });
  }

  function done(code: string): void {
    apply(code, { type: "done" });
  }

  function report(code: string, info: { runId: string; sha256: string; runtime: string }): void {
    apply(code, { type: "report", ...info });
  }

  function stop(): void {
    clearInterval(ticker);
    for (const timers of [broadcasts, lobbyTimers, endedTimers]) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
    for (const conn of conns.values()) {
      if (conn.idle) clearTimeout(conn.idle);
      if (conn.hello) clearTimeout(conn.hello);
    }
  }

  const ticker = setInterval(() => {
    for (const [code, state] of rooms) {
      if (state.phase === "ended") continue;
      apply(code, { type: "tick" });
    }
  }, tickMs);
  unref(ticker);

  function heard(conn: Conn): void {
    if (conn.idle) clearTimeout(conn.idle);
    conn.idle = setTimeout(() => conn.transport.close(), IDLE_MS);
    unref(conn.idle);
  }

  function onRaw(conn: Conn, raw: unknown): void {
    if (conn.dropped) return;
    heard(conn);
    const at = now();
    const cutoff = at - 1000;
    conn.times = conn.times.filter((stamp) => stamp > cutoff);
    conn.times.push(at);
    if (conn.times.length > 20) {
      kick(conn, "rate");
      return;
    }
    const msg = parseClientMessage(raw);
    if (!msg) {
      // Answered, so a client of another version sees it was not understood, and the socket stays open.
      send(conn, { t: "ack", v: 1, id: rawId(raw), ok: false, err: "invalid" });
      return;
    }
    if (!conn.joined) {
      firstContact(conn, msg);
      return;
    }
    if (!conn.code) return;
    apply(conn.code, { type: "message", connId: conn.id, msg });
  }

  function firstContact(conn: Conn, msg: ClientMessage): void {
    if (msg.t !== "hello") {
      send(conn, { t: "ack", v: 1, id: msg.id, ok: false, err: "invalid" });
      conn.transport.close();
      return;
    }
    const state = rooms.get(msg.room);
    if (!state) {
      send(conn, { t: "ack", v: 1, id: msg.id, ok: false, err: "unknown-room" });
      conn.transport.close();
      return;
    }
    const isMaster = msg.role === "master" && msg.token === state.ownerToken;
    if (!isMaster && audienceCount(msg.room) >= (state.show ? maxConnShow : maxConnPublic)) {
      // No answer and no reason: the phone takes it as a lost link and tries again with growing waits.
      conn.transport.close();
      return;
    }
    conn.joined = true;
    conn.code = msg.room;
    if (conn.hello) {
      clearTimeout(conn.hello);
      conn.hello = null;
    }
    let set = roomConns.get(msg.room);
    if (!set) {
      set = new Set();
      roomConns.set(msg.room, set);
    }
    set.add(conn.id);
    apply(msg.room, { type: "message", connId: conn.id, msg });
    if (msg.role === "master") conn.master = isMaster;
  }

  function audienceCount(code: string): number {
    const ids = roomConns.get(code);
    if (!ids) return 0;
    let count = 0;
    for (const id of ids) {
      const conn = conns.get(id);
      if (conn && !conn.dropped && !conn.master) count += 1;
    }
    return count;
  }

  function env(state: RoomState): Env {
    return { now: now(), random, timing, mayStart: mayStart(state) };
  }

  /** A show room always has its own slot; a public room needs one of the public hold slots free. */
  function mayStart(state: RoomState): boolean {
    if (state.show) return true;
    let holding = 0;
    for (const [code, other] of rooms) {
      if (code !== state.code && !other.show && other.phase === "hold") holding += 1;
    }
    return holding < publicHoldSlots;
  }

  function apply(code: string, event: RoomEvent): void {
    const state = rooms.get(code);
    if (!state) return;
    const result = reduce(state, event, env(state));
    rooms.set(code, result.state);
    if (state.phase !== "ended" && result.state.phase === "ended") scheduleEnded(code);
    for (const effect of result.effects) {
      if (effect.type === "send") {
        const target = conns.get(effect.connId);
        if (target) send(target, effect.msg);
      } else if (effect.type === "kick") {
        const target = conns.get(effect.connId);
        if (target) kick(target, effect.reason);
      } else if (effect.type === "runner") {
        callRunner(code, effect);
      } else {
        scheduleBroadcast(code);
      }
    }
  }

  function callRunner(code: string, effect: Extract<Effect, { type: "runner" }>): void {
    if (!runner) return;
    if (effect.action === "start") runner.start(code, effect.agents);
    else if (effect.action === "door") runner.door(code);
    else runner.stop(code);
  }

  function scheduleBroadcast(code: string): void {
    if (broadcasts.has(code)) return;
    const timer = setTimeout(() => {
      broadcasts.delete(code);
      const state = rooms.get(code);
      if (!state) return;
      const ids = roomConns.get(code);
      if (!ids) return;
      const shared = stateMessage(state, { master: false });
      const forMaster = stateMessage(state, { master: true });
      for (const id of ids) {
        const conn = conns.get(id);
        if (!conn || conn.dropped) continue;
        send(conn, conn.master ? forMaster : shared);
      }
    }, throttleMs);
    unref(timer);
    broadcasts.set(code, timer);
  }

  function scheduleLobby(code: string): void {
    const timer = setTimeout(() => {
      lobbyTimers.delete(code);
      const state = rooms.get(code);
      if (state && state.phase === "lobby") remove(code);
    }, lobbyTtlMs);
    unref(timer);
    lobbyTimers.set(code, timer);
  }

  function scheduleEnded(code: string): void {
    const timer = setTimeout(() => {
      endedTimers.delete(code);
      const state = rooms.get(code);
      if (state && state.phase === "ended") remove(code);
    }, endedTtlMs);
    unref(timer);
    endedTimers.set(code, timer);
  }

  function remove(code: string): void {
    const state = rooms.get(code);
    rooms.delete(code);
    for (const timers of [broadcasts, lobbyTimers, endedTimers]) {
      const timer = timers.get(code);
      if (timer) clearTimeout(timer);
      timers.delete(code);
    }
    const ids = roomConns.get(code);
    roomConns.delete(code);
    if (state && state.phase === "hold") callRunner(code, { type: "runner", action: "stop" });
    if (!ids) return;
    for (const id of ids) {
      const conn = conns.get(id);
      if (!conn || conn.dropped) continue;
      // Gone before the sockets close, so their closes change no room.
      send(conn, { t: "ack", v: 1, id: "", ok: false, err: "unknown-room" });
      conn.transport.close();
    }
  }

  function drop(conn: Conn): void {
    if (conn.dropped) return;
    conn.dropped = true;
    if (conn.idle) clearTimeout(conn.idle);
    if (conn.hello) clearTimeout(conn.hello);
    conns.delete(conn.id);
    const code = conn.code;
    if (!code) return;
    const set = roomConns.get(code);
    if (set) {
      set.delete(conn.id);
      if (set.size === 0) roomConns.delete(code);
    }
    apply(code, { type: "close", connId: conn.id });
  }

  function kick(conn: Conn, reason: "rate" | "closed"): void {
    if (conn.dropped) return;
    send(conn, { t: "kicked", v: 1, reason });
    conn.transport.close();
  }

  function send(conn: Conn, msg: ServerMessage): void {
    if (conn.dropped) return;
    conn.transport.send(msg);
  }

  return { createRoom, accept, attempt, escaped, mode, done, report, room, stop };
}

/** The id of a message the hub could not parse, if it carries one of the protocol's shape, else "". */
function rawId(raw: unknown): string {
  const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.length >= 1 && id.length <= 64 ? id : "";
}

function makeCode(random: () => number, taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      const raw = Math.floor(random() * ALPHABET.length);
      code += ALPHABET[Math.min(ALPHABET.length - 1, Math.max(0, raw))];
    }
    if (!taken(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}

/** Housekeeping waits must not keep a stopping server or a finished test running (Node only). */
function unref(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}
