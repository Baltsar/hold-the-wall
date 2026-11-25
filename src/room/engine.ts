import type { Attempt, ClientMessage, MasterCommand, Phase, Reveal, Role, ServerMessage } from "./protocol.ts";

/**
 * Every duration the room runs on. The hub may pass its own; tests use short ones. The engine itself
 * never reads a clock: `now` and `random` come in on each event.
 */
export interface Timing {
  holdMs: number;
  /** First offer this far into hold. */
  offerAtMs: number;
  offerTtlMs: number;
  doorDelayMinMs: number;
  doorDelayMaxMs: number;
  revealToEndMs: number;
  /** A solo room enters hold this long after its first seat. */
  soloStartMs: number;
  /** A held seat with no message for this long is let go. */
  holdExpiryMs: number;
  /** Lobby only: a disconnected seat is removed after this. */
  seatGraceMs: number;
}

export const DEFAULT_TIMING: Timing = {
  holdMs: 180_000,
  offerAtMs: 60_000,
  offerTtlMs: 20_000,
  doorDelayMinMs: 3_000,
  doorDelayMaxMs: 10_000,
  revealToEndMs: 30_000,
  soloStartMs: 5_000,
  holdExpiryMs: 8_000,
  seatGraceMs: 30_000,
};

export interface Env {
  now: number;
  random: () => number;
  timing: Timing;
  /** False when this is a public room and two other public rooms are in hold. */
  mayStart: boolean;
}

/** One piece of wall. A seat keeps its `pos` for the whole show, and display order is by `pos`. */
export interface Seat {
  clientId: string;
  pos: number;
  held: boolean;
  /** The connection bound to the seat now, or null after a disconnect. */
  connId: string | null;
  lastHeardAt: number;
  /** Lobby only: when a disconnected seat is dropped. */
  removeAt: number | null;
  /** Whether this person has ever been offered the door. */
  offered: boolean;
  /** When this seat becomes a visible door, or null. */
  doorAt: number | null;
  /** A visible door: this piece shows "2" and no hold closes it. */
  door: boolean;
}

interface Binding {
  role: Role;
  clientId: string;
}

/** An offer that may be live. Several may be live at once. Never leaves the room except to its own connection. */
interface LiveOffer {
  id: string;
  connId: string;
  sentAt: number;
}

export interface RoomState {
  code: string;
  ownerToken: string;
  solo: boolean;
  show: boolean;
  phase: Phase;
  seq: number;
  /** A start was refused because the public slots were full. Cleared by the next successful start. */
  busy: boolean;
  mode: "live" | "scripted";
  timing: Timing;
  seats: Seat[];
  conns: Record<string, Binding>;
  holdStartedAt: number | null;
  /** Milliseconds spent in hold, accumulated on ticks. */
  holdElapsed: number;
  /** Milliseconds of that in which every seat was held and no door was visible. */
  wholeMs: number;
  lastTickAt: number | null;
  /** Solo only: when the room starts by itself. */
  soloAt: number | null;
  /** Offers waiting on an answer. */
  offers: LiveOffer[];
  offeredTotal: number;
  /** Offers whose phone pressed open, whether or not their door is visible yet. */
  acceptedTotal: number;
  /** Agents that ran the show, 0 before hold. */
  agents: number;
  attempts: Attempt[];
  reveal: Reveal | null;
  revealAt: number | null;
  runId: string | null;
  sha256: string | null;
  runtime: string | null;
  /** When each connection last sent a hold change, for the ten-a-second limit. */
  holdTimes: Record<string, number[]>;
}

export type RoomEvent =
  | { type: "message"; connId: string; msg: ClientMessage }
  | { type: "close"; connId: string }
  /** The hub sends one every 250 ms. */
  | { type: "tick" }
  | { type: "attempt"; input: AttemptInput }
  /** A late canary: mark attempt n escaped. */
  | { type: "escaped"; n: number }
  | { type: "mode"; mode: "live" | "scripted" }
  /** The agent has no more attempts. */
  | { type: "done" }
  | { type: "report"; runId: string; sha256: string; runtime: string };

export type AttemptInput = Omit<Attempt, "n" | "via" | "at">;

export type Effect =
  | { type: "send"; connId: string; msg: ServerMessage }
  | { type: "broadcast" }
  | { type: "kick"; connId: string; reason: "rate" | "closed" }
  | { type: "runner"; action: "start"; agents: number }
  | { type: "runner"; action: "door" | "stop" };

interface Step {
  state: RoomState;
  effects: Effect[];
}

export function createRoom(init: {
  code: string;
  ownerToken: string;
  solo: boolean;
  show: boolean;
  timing?: Timing;
}): RoomState {
  return {
    code: init.code,
    ownerToken: init.ownerToken,
    solo: init.solo,
    show: init.show,
    phase: "lobby",
    seq: 0,
    busy: false,
    mode: "live",
    timing: init.timing ?? DEFAULT_TIMING,
    seats: [],
    conns: {},
    holdStartedAt: null,
    holdElapsed: 0,
    wholeMs: 0,
    lastTickAt: null,
    soloAt: null,
    offers: [],
    offeredTotal: 0,
    acceptedTotal: 0,
    agents: 0,
    attempts: [],
    reveal: null,
    revealAt: null,
    runId: null,
    sha256: null,
    runtime: null,
    holdTimes: {},
  };
}

export function reduce(state: RoomState, event: RoomEvent, env: Env): Step {
  const base = withTiming(state, env.timing);
  switch (event.type) {
    case "message":
      return onMessage(base, event.connId, event.msg, env);
    case "close":
      return onClose(base, event.connId, env);
    case "tick":
      return onTick(base, env);
    case "attempt":
      return onAttempt(base, event.input, env);
    case "escaped":
      return onEscaped(base, event.n, env);
    case "mode":
      return onMode(base, event.mode);
    case "done":
      return onDone(base, env);
    case "report":
      return onReport(base, event.runId, event.sha256, event.runtime);
  }
}

/** The state for one connection. A master also gets everything a phone must never see. */
export function stateMessage(state: RoomState, opts: { master: boolean }): Extract<ServerMessage, { t: "state" }> {
  const msg: Extract<ServerMessage, { t: "state" }> = {
    t: "state",
    v: 1,
    seq: state.seq,
    code: state.code,
    phase: state.phase,
    participants: state.seats.length,
    holding: state.seats.reduce((n, seat) => n + (seat.held ? 1 : 0), 0),
    mode: state.mode,
    busy: state.busy,
  };
  if (!opts.master) return msg;
  msg.solo = state.solo;
  msg.wall = displayOrder(state)
    .map((seat) => (seat.door ? "2" : seat.held ? "1" : "0"))
    .join("");
  msg.doors = state.seats.reduce((n, seat) => n + (seat.door ? 1 : 0), 0);
  msg.agents = state.agents;
  msg.attempts = {
    total: state.attempts.length,
    pastYou: pastYou(state.attempts),
    contained: countVerdict(state.attempts, "contained"),
    escaped: countVerdict(state.attempts, "escaped"),
  };
  msg.feed = state.attempts.slice(-20).map((attempt) => ({
    ...attempt,
    command: clip(attempt.command, 160),
    output: clip(attempt.output, 200),
  }));
  if (state.reveal) msg.reveal = state.reveal;
  msg.holdStartedAt = state.holdStartedAt;
  msg.holdMs = state.timing.holdMs;
  return msg;
}

function onMessage(state: RoomState, connId: string, msg: ClientMessage, env: Env): Step {
  const binding = state.conns[connId];
  if (!binding) {
    if (msg.t !== "hello") return done(state, ackErr(connId, msg.id, "invalid"));
    return onHello(state, connId, msg, env);
  }
  if (msg.t === "hello") return done(state, ackErr(connId, msg.id, "invalid"));
  // Every message from a connection keeps its seat alive, ping included.
  const heard = touch(state, connId, env.now);
  switch (msg.t) {
    case "join":
      return onJoin(heard, connId, msg.id, env);
    case "hold":
      return onHold(heard, connId, msg.id, msg.on, env);
    case "open":
      return onOpen(heard, connId, msg.id, msg.offer, env);
    case "ping":
      return done(heard, { type: "send", connId, msg: { t: "pong", v: 1, seq: msg.seq } });
    case "command":
      return onCommand(heard, connId, msg.id, msg.command, env);
  }
}

function onHello(state: RoomState, connId: string, msg: Extract<ClientMessage, { t: "hello" }>, env: Env): Step {
  if (msg.role === "master") {
    if (msg.token !== state.ownerToken) return done(state, ackErr(connId, msg.id, "forbidden"));
    const next = withConn(state, connId, { role: "master", clientId: msg.clientId });
    return {
      state: next,
      effects: [ackOk(connId, msg.id), sendState(connId, next, true)],
    };
  }
  const bound = withConn(state, connId, { role: "audience", clientId: msg.clientId });
  const effects: Effect[] = [ackOk(connId, msg.id)];
  let next = bound;
  const index = bound.seats.findIndex((seat) => seat.clientId === msg.clientId);
  if (index >= 0) {
    const seat = { ...bound.seats[index], connId, removeAt: null, lastHeardAt: env.now };
    const seats = bound.seats.slice();
    seats[index] = seat;
    next = { ...bound, seats };
    effects.push({ type: "send", connId, msg: { t: "you", v: 1, holding: seat.held } });
  }
  effects.push(sendState(connId, next, false));
  return { state: next, effects };
}

function onJoin(state: RoomState, connId: string, id: string, env: Env): Step {
  const binding = state.conns[connId];
  if (!binding || binding.role !== "audience") return done(state, ackErr(connId, id, "forbidden"));
  if (state.phase === "reveal" || state.phase === "ended") return done(state, ackErr(connId, id, "closed"));

  const index = state.seats.findIndex((seat) => seat.clientId === binding.clientId);
  if (index >= 0) {
    const seat = { ...state.seats[index], connId, removeAt: null, lastHeardAt: env.now };
    const seats = state.seats.slice();
    seats[index] = seat;
    return done({ ...state, seats }, ackOk(connId, id));
  }

  const seat: Seat = {
    clientId: binding.clientId,
    pos: env.random(),
    held: false,
    connId,
    lastHeardAt: env.now,
    removeAt: null,
    offered: false,
    doorAt: null,
    door: false,
  };
  let next: RoomState = { ...state, seats: [...state.seats, seat] };
  if (next.solo && next.phase === "lobby" && state.seats.length === 0) {
    next = { ...next, soloAt: env.now + env.timing.soloStartMs };
  }
  return changed(next, ackOk(connId, id));
}

function onHold(state: RoomState, connId: string, id: string, on: boolean, env: Env): Step {
  const index = state.seats.findIndex((seat) => seat.connId === connId);
  const binding = state.conns[connId];
  if (!binding || binding.role !== "audience" || index < 0 || state.phase !== "hold") {
    return done(state, ackOk(connId, id));
  }
  const seat = state.seats[index];
  const cutoff = env.now - 1000;
  const times = (state.holdTimes[connId] ?? []).filter((stamp) => stamp > cutoff);
  if (times.length >= 10) {
    // Over the ten changes a second: ignored, not punished, and the phone is told where it stands.
    const next = { ...state, holdTimes: { ...state.holdTimes, [connId]: times } };
    return done(next, ackOk(connId, id), you(connId, seat.held));
  }
  const seats = state.seats.slice();
  seats[index] = { ...seat, held: on, lastHeardAt: env.now };
  let next: RoomState = { ...state, seats, holdTimes: { ...state.holdTimes, [connId]: [...times, env.now] } };
  const effects: Effect[] = [ackOk(connId, id), you(connId, on)];
  if (seat.held !== on) {
    next = bump(next);
    effects.push({ type: "broadcast" });
  }
  return { state: next, effects };
}

function onOpen(state: RoomState, connId: string, id: string, offer: string, env: Env): Step {
  const live =
    state.phase === "hold"
      ? state.offers.find(
          (candidate) => candidate.id === offer && candidate.connId === connId && env.now < candidate.sentAt + env.timing.offerTtlMs,
        )
      : undefined;
  if (!live) return done(state, ackErr(connId, id, "forbidden"));

  const index = state.seats.findIndex((seat) => seat.connId === connId);
  if (index < 0) return done(state, ackErr(connId, id, "forbidden"));

  const spread = env.timing.doorDelayMaxMs - env.timing.doorDelayMinMs;
  const delay = Math.round(env.timing.doorDelayMinMs + env.random() * spread);
  const seats = state.seats.slice();
  seats[index] = { ...state.seats[index], doorAt: env.now + delay };
  const next: RoomState = {
    ...state,
    seats,
    offers: state.offers.filter((candidate) => candidate !== live),
    acceptedTotal: state.acceptedTotal + 1,
  };
  return {
    state: next,
    effects: [ackOk(connId, id), { type: "send", connId, msg: { t: "offerEnd", v: 1, offer: live.id } }],
  };
}

function onCommand(
  state: RoomState,
  connId: string,
  id: string,
  command: MasterCommand,
  env: Env,
): Step {
  const binding = state.conns[connId];
  if (!binding || binding.role !== "master") return done(state, ackErr(connId, id, "forbidden"));
  switch (command.kind) {
    case "start":
      return onStart(state, connId, id, env);
    case "reveal": {
      if (state.phase === "reveal" || state.phase === "ended") return done(state, ackOk(connId, id));
      const revealed = revealNow(state, env.now);
      return { state: revealed.state, effects: [ackOk(connId, id), ...revealed.effects] };
    }
    case "end":
    case "stop": {
      if (state.phase === "ended") return done(state, ackOk(connId, id));
      const ended = endNow(state, env.now);
      return { state: ended.state, effects: [ackOk(connId, id), ...ended.effects] };
    }
  }
}

function onStart(state: RoomState, connId: string, id: string, env: Env): Step {
  if (state.phase !== "lobby") return done(state, ackOk(connId, id));
  if (!env.mayStart) {
    if (state.busy) return done(state, ackOk(connId, id));
    return changed({ ...state, busy: true }, ackOk(connId, id));
  }
  const held = beginHold(state, env.now);
  return { state: held.state, effects: [ackOk(connId, id), ...held.effects] };
}

function onTick(state: RoomState, env: Env): Step {
  switch (state.phase) {
    case "lobby":
      return tickLobby(state, env);
    case "hold":
      return tickHold(state, env);
    case "reveal":
      return tickReveal(state, env);
    case "ended":
      return done(state);
  }
}

function tickLobby(state: RoomState, env: Env): Step {
  const now = env.now;
  let next = state;
  let visible = false;

  const kept = state.seats.filter((seat) => seat.removeAt === null || now < seat.removeAt);
  if (kept.length !== state.seats.length) {
    next = { ...next, seats: kept };
    visible = true;
    if (kept.length === 0 && next.solo) next = { ...next, soloAt: null };
  }

  if (next.solo && next.soloAt !== null && next.seats.length > 0 && now >= next.soloAt) {
    if (env.mayStart) return beginHold(next, now);
    if (!next.busy) {
      next = { ...next, busy: true };
      visible = true;
    }
  }

  if (visible) {
    next = bump(next);
    return { state: next, effects: [{ type: "broadcast" }] };
  }
  return done(next);
}

function tickHold(state: RoomState, env: Env): Step {
  const now = env.now;
  const timing = env.timing;
  const from = state.lastTickAt ?? now;
  const dt = Math.max(0, now - from);
  const whole = state.seats.length > 0 && state.seats.every((seat) => seat.held && !seat.door);
  let next: RoomState = {
    ...state,
    holdElapsed: state.holdElapsed + dt,
    wholeMs: state.wholeMs + (whole ? dt : 0),
    lastTickAt: now,
  };
  const effects: Effect[] = [];
  let visible = false;

  const expired = expireSeats(next, now, timing);
  if (expired.visible) {
    next = { ...next, seats: expired.seats };
    visible = true;
  }

  const expiredOffers = next.offers.filter((offer) => now >= offer.sentAt + timing.offerTtlMs);
  const offerEnded = expiredOffers.length > 0;
  if (offerEnded) {
    for (const offer of expiredOffers) {
      effects.push({ type: "send", connId: offer.connId, msg: { t: "offerEnd", v: 1, offer: offer.id } });
    }
    next = { ...next, offers: next.offers.filter((offer) => now < offer.sentAt + timing.offerTtlMs) };
  }

  if (!offerEnded && now - (next.holdStartedAt ?? now) >= timing.offerAtMs) {
    const slots = next.solo ? 1 : Math.max(1, Math.round(next.seats.length / 25));
    const soloDone = next.solo && next.offeredTotal > 0;
    while (!soloDone && next.offers.length + next.acceptedTotal < slots) {
      const candidates: { seat: Seat; connId: string }[] = [];
      for (const seat of next.seats) {
        if (!seat.offered && !seat.door && seat.connId !== null) candidates.push({ seat, connId: seat.connId });
      }
      if (candidates.length === 0) break;
      const pick = candidates[pickIndex(env.random, candidates.length)];
      const offer = randomHex(env.random, 24);
      next = {
        ...next,
        seats: next.seats.map((seat) => (seat.clientId === pick.seat.clientId ? { ...seat, offered: true } : seat)),
        offers: [...next.offers, { id: offer, connId: pick.connId, sentAt: now }],
        offeredTotal: next.offeredTotal + 1,
      };
      effects.push({ type: "send", connId: pick.connId, msg: { t: "offer", v: 1, offer, ttlMs: timing.offerTtlMs } });
    }
  }

  const opening = next.seats.filter((seat) => seat.doorAt !== null && !seat.door && now >= seat.doorAt);
  if (opening.length > 0) {
    const ids = new Set(opening.map((seat) => seat.clientId));
    next = { ...next, seats: next.seats.map((seat) => (ids.has(seat.clientId) ? { ...seat, door: true } : seat)) };
    for (let i = 0; i < opening.length; i += 1) effects.push({ type: "runner", action: "door" });
    visible = true;
  }

  if (next.holdStartedAt !== null && now - next.holdStartedAt >= timing.holdMs) {
    const revealed = revealNow(next, now);
    return { state: revealed.state, effects: [...effects, ...revealed.effects] };
  }
  if (visible) {
    next = bump(next);
    effects.push({ type: "broadcast" });
  }
  return { state: next, effects };
}

function tickReveal(state: RoomState, env: Env): Step {
  const expired = expireSeats(state, env.now, env.timing);
  const next = expired.visible ? { ...state, seats: expired.seats } : state;
  if (next.revealAt !== null && env.now - next.revealAt >= env.timing.revealToEndMs) {
    return endNow(next, env.now);
  }
  if (expired.visible) {
    const bumped = bump(next);
    return { state: bumped, effects: [{ type: "broadcast" }] };
  }
  return done(next);
}

function onAttempt(state: RoomState, input: AttemptInput, env: Env): Step {
  if (state.phase !== "hold" || state.holdStartedAt === null) return done(state);
  const via = attemptVia(state, env.random);
  const attempt: Attempt = {
    n: state.attempts.length + 1,
    category: input.category,
    command: input.command,
    exit: input.exit,
    output: input.output,
    verdict: input.verdict,
    source: input.source,
    root: input.root,
    agent: input.agent,
    via,
    at: env.now - state.holdStartedAt,
  };
  const next: RoomState = { ...state, attempts: [...state.attempts, attempt] };
  const effects: Effect[] = [];
  const probe = probeEffect(next, attempt);
  if (probe) effects.push(probe);
  if (attempt.verdict === "escaped") {
    const revealed = revealNow(next, env.now);
    return { state: revealed.state, effects: [...effects, ...revealed.effects] };
  }
  return { state: bump(next), effects: [...effects, { type: "broadcast" }] };
}

/** Tells the piece of wall an attempt met, if its phone is still connected. */
function probeEffect(state: RoomState, attempt: Attempt): Effect | null {
  if (attempt.via.index < 0) return null;
  const seat = displayOrder(state)[attempt.via.index];
  if (!seat || seat.connId === null) return null;
  const outcome = attempt.via.kind === "door" ? "door" : attempt.via.kind === "gap" ? "through" : "held";
  return { type: "send", connId: seat.connId, msg: { t: "probe", v: 1, agent: attempt.agent, outcome } };
}

function onEscaped(state: RoomState, n: number, env: Env): Step {
  const index = state.attempts.findIndex((attempt) => attempt.n === n);
  if (index < 0) return done(state);
  const attempts = state.attempts.slice();
  attempts[index] = { ...attempts[index], verdict: "escaped" };
  const next: RoomState = { ...state, attempts };
  if (state.phase === "hold") return revealNow(next, env.now);
  // A canary that fires after the reveal still changes what the stage says the show measured.
  const revealed = state.reveal ? { ...next, reveal: computeReveal(next) } : next;
  return changed(revealed);
}

function onMode(state: RoomState, mode: "live" | "scripted"): Step {
  if (state.mode === mode) return done(state);
  return changed({ ...state, mode });
}

function onDone(state: RoomState, env: Env): Step {
  if (state.phase !== "hold") return done(state);
  return revealNow(state, env.now);
}

function onReport(state: RoomState, runId: string, sha256: string, runtime: string): Step {
  if (state.runId === runId && state.sha256 === sha256 && state.runtime === runtime) return done(state);
  const next: RoomState = { ...state, runId, sha256, runtime };
  const withReveal = state.reveal ? { ...next, reveal: computeReveal(next) } : next;
  return changed(withReveal);
}

function onClose(state: RoomState, connId: string, env: Env): Step {
  const binding = state.conns[connId];
  if (!binding) return done(state);
  const conns = { ...state.conns };
  delete conns[connId];
  const holdTimes = { ...state.holdTimes };
  delete holdTimes[connId];
  let next: RoomState = { ...state, conns, holdTimes };
  let visible = false;

  const index = next.seats.findIndex((seat) => seat.connId === connId);
  if (index >= 0) {
    const seat = next.seats[index];
    const seats = next.seats.slice();
    seats[index] = {
      ...seat,
      connId: null,
      held: false,
      removeAt: state.phase === "lobby" ? env.now + env.timing.seatGraceMs : null,
      lastHeardAt: env.now,
    };
    next = { ...next, seats };
    visible = seat.held;
  }
  if (next.offers.some((offer) => offer.connId === connId)) {
    next = { ...next, offers: next.offers.filter((offer) => offer.connId !== connId) };
  }

  if (visible) {
    next = bump(next);
    return { state: next, effects: [{ type: "broadcast" }] };
  }
  return done(next);
}

/** Ticks a seat over the eight-second silence, or a seat whose connection is gone. */
function expireSeats(state: RoomState, now: number, timing: Timing): { seats: Seat[]; visible: boolean } {
  let visible = false;
  const seats = state.seats.map((seat) => {
    if (!seat.held) return seat;
    const silent = seat.connId === null || now - seat.lastHeardAt > timing.holdExpiryMs;
    if (!silent) return seat;
    visible = true;
    return { ...seat, held: false };
  });
  return { seats, visible };
}

function beginHold(state: RoomState, now: number): Step {
  const agents = state.solo ? 1 : Math.min(3, Math.max(1, Math.ceil(state.seats.length / 30)));
  const next = bump({
    ...state,
    phase: "hold",
    busy: false,
    agents,
    holdStartedAt: now,
    holdElapsed: 0,
    wholeMs: 0,
    lastTickAt: now,
  });
  return { state: next, effects: [{ type: "runner", action: "start", agents }, { type: "broadcast" }] };
}

function revealNow(state: RoomState, now: number): Step {
  const next = bump({ ...state, phase: "reveal", revealAt: now, reveal: computeReveal(state) });
  return { state: next, effects: [{ type: "runner", action: "stop" }, { type: "broadcast" }] };
}

function endNow(state: RoomState, now: number): Step {
  const wasHold = state.phase === "hold";
  const next = bump({
    ...state,
    phase: "ended",
    reveal: state.reveal ?? computeReveal(state),
    revealAt: state.revealAt ?? now,
  });
  const effects: Effect[] = [];
  if (wasHold) effects.push({ type: "runner", action: "stop" });
  effects.push({ type: "broadcast" });
  return { state: next, effects };
}

function computeReveal(state: RoomState): Reveal {
  const held = state.holdElapsed;
  const attempts = state.attempts;
  const escaped = countVerdict(attempts, "escaped");
  const offered = state.offeredTotal;
  const accepted = state.acceptedTotal;
  const ending = escaped > 0 ? "escaped" : offered > 0 && accepted === 0 ? "nobody-opened" : "contained";
  return {
    attempts: attempts.length,
    wholePct: held === 0 ? 0 : Math.round((100 * state.wholeMs) / held),
    pastYou: pastYou(attempts),
    offered,
    declined: offered - accepted,
    contained: countVerdict(attempts, "contained"),
    escaped,
    doorOpened: accepted > 0,
    agents: state.agents,
    doors: state.seats.reduce((n, seat) => n + (seat.door ? 1 : 0), 0),
    rootUsed: attempts.some((attempt) => attempt.root),
    ending,
    runId: state.runId,
    sha256: state.sha256,
    runtime: state.runtime,
  };
}

function attemptVia(state: RoomState, random: () => number): Attempt["via"] {
  const seats = displayOrder(state);
  if (seats.length === 0) return { kind: "wall", index: -1 };
  const doors: number[] = [];
  const gaps: number[] = [];
  seats.forEach((seat, index) => {
    if (seat.door) doors.push(index);
    else if (!seat.held) gaps.push(index);
  });
  // Half the time the agent goes for a weak spot (a door first, then a gap); otherwise it tries any
  // piece at random. So a door matters as much as it is wide, and the people still holding keep
  // getting hit and keep mattering after a door has opened.
  const weak = doors.length > 0 ? doors : gaps;
  if (weak.length > 0 && random() < 0.5) {
    const index = weak[pickIndex(random, weak.length)];
    return { kind: doors.length > 0 ? "door" : "gap", index };
  }
  const index = pickIndex(random, seats.length);
  const seat = seats[index];
  return { kind: seat.door ? "door" : seat.held ? "wall" : "gap", index };
}

function displayOrder(state: RoomState): Seat[] {
  return state.seats
    .slice()
    .sort((a, b) => a.pos - b.pos || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}

function pastYou(attempts: Attempt[]): number {
  return attempts.reduce((n, attempt) => n + (attempt.via.kind === "wall" ? 0 : 1), 0);
}

function countVerdict(attempts: Attempt[], verdict: Attempt["verdict"]): number {
  return attempts.reduce((n, attempt) => n + (attempt.verdict === verdict ? 1 : 0), 0);
}

/** Marks a seat heard from, without touching anything a client can see. */
function touch(state: RoomState, connId: string, now: number): RoomState {
  const index = state.seats.findIndex((seat) => seat.connId === connId);
  if (index < 0) return state;
  const seat = state.seats[index];
  if (seat.lastHeardAt === now) return state;
  const seats = state.seats.slice();
  seats[index] = { ...seat, lastHeardAt: now };
  return { ...state, seats };
}

function withConn(state: RoomState, connId: string, binding: Binding): RoomState {
  return { ...state, conns: { ...state.conns, [connId]: binding } };
}

/** Keeps the room's copy of the timing in step with the hub's, so a state message can carry holdMs. */
function withTiming(state: RoomState, timing: Timing): RoomState {
  const current = state.timing;
  if (
    current.holdMs === timing.holdMs &&
    current.offerAtMs === timing.offerAtMs &&
    current.offerTtlMs === timing.offerTtlMs &&
    current.doorDelayMinMs === timing.doorDelayMinMs &&
    current.doorDelayMaxMs === timing.doorDelayMaxMs &&
    current.revealToEndMs === timing.revealToEndMs &&
    current.soloStartMs === timing.soloStartMs &&
    current.holdExpiryMs === timing.holdExpiryMs &&
    current.seatGraceMs === timing.seatGraceMs
  ) {
    return state;
  }
  return { ...state, timing };
}

function bump(state: RoomState): RoomState {
  return { ...state, seq: state.seq + 1 };
}

function ackOk(connId: string, id: string): Effect {
  return { type: "send", connId, msg: { t: "ack", v: 1, id, ok: true } };
}

function ackErr(connId: string, id: string, err: "forbidden" | "invalid" | "closed" | "unknown-room"): Effect {
  return { type: "send", connId, msg: { t: "ack", v: 1, id, ok: false, err } };
}

function you(connId: string, holding: boolean): Effect {
  return { type: "send", connId, msg: { t: "you", v: 1, holding } };
}

function sendState(connId: string, state: RoomState, master: boolean): Effect {
  return { type: "send", connId, msg: stateMessage(state, { master }) };
}

/** The common case: a visible change, a broadcast, and no other effects. */
function changed(state: RoomState, ...extra: Effect[]): Step {
  return { state: bump(state), effects: [...extra, { type: "broadcast" }] };
}

function done(state: RoomState, ...effects: Effect[]): Step {
  return { state, effects };
}

function pickIndex(random: () => number, length: number): number {
  const raw = Math.floor(random() * length);
  return Math.min(length - 1, Math.max(0, raw));
}

function randomHex(random: () => number, length: number): string {
  const alphabet = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[pickIndex(random, alphabet.length)];
  return out;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}
