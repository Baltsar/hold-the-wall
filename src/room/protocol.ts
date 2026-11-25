import { z } from "zod";

export type Role = "audience" | "master";
export type Phase = "lobby" | "hold" | "reveal" | "ended";

export type Category = "filesystem" | "network" | "privilege" | "resources" | "persistence" | "other";

export type MasterCommand = { kind: "start" } | { kind: "reveal" } | { kind: "end" } | { kind: "stop" };

export type ClientMessage =
  | { t: "hello"; v: 1; id: string; room: string; clientId: string; role: Role; token?: string }
  | { t: "join"; v: 1; id: string }
  | { t: "hold"; v: 1; id: string; on: boolean }
  | { t: "open"; v: 1; id: string; offer: string }
  | { t: "ping"; v: 1; id: string; seq: number }
  | { t: "command"; v: 1; id: string; command: MasterCommand };

/** One attempt the agent made, as the room reports it. Never sent to a phone. */
export interface Attempt {
  n: number;
  category: Category;
  /** What ran, cut to 160 characters in state messages. */
  command: string;
  /** Null when the sandbox killed it on the timeout. */
  exit: number | null;
  /** The first 200 characters of stdout and stderr, cut in state messages. */
  output: string;
  verdict: "contained" | "escaped";
  source: "model" | "script";
  root: boolean;
  /** 0-based, which agent made the attempt. */
  agent: number;
  /** `index` is the seat's position in the display-ordered wall string of the same state message. */
  via: { kind: "wall"; index: number } | { kind: "gap"; index: number } | { kind: "door"; index: number };
  /** Milliseconds since hold started. */
  at: number;
}

/** The show's numbers, measured, as the stage tells them at the end. */
export interface Reveal {
  attempts: number;
  /** round(100 * wholeMs / holdMs), 0 when holdMs is 0. */
  wholePct: number;
  /** Attempts whose way in was a gap or the door. */
  pastYou: number;
  offered: number;
  /** Offered minus accepted. */
  declined: number;
  contained: number;
  escaped: number;
  /** True when a door is visible or one is still pending. */
  doorOpened: boolean;
  /** How many agents ran the show. */
  agents: number;
  /** Doors that became visible. */
  doors: number;
  rootUsed: boolean;
  ending: "contained" | "nobody-opened" | "escaped";
  runId: string | null;
  sha256: string | null;
  runtime: string | null;
}

export type ServerMessage =
  | {
      t: "state";
      v: 1;
      seq: number;
      code: string;
      phase: Phase;
      /** Seats on the wall. */
      participants: number;
      /** Seats held right now. */
      holding: number;
      mode: "live" | "scripted";
      /** A start was refused because the public slots are full. */
      busy: boolean;
      /** Masters only. */
      solo?: boolean;
      /** Masters only: one character per seat in display order, "1" held, "0" gap, "2" door. */
      wall?: string;
      /** Masters only: visible door seats. */
      doors?: number;
      /** Masters only: agents that ran the show, 0 before hold. */
      agents?: number;
      attempts?: { total: number; pastYou: number; contained: number; escaped: number };
      /** Masters only: the last 20 attempts. */
      feed?: Attempt[];
      /** Masters only: from phase "reveal" on. */
      reveal?: Reveal;
      holdStartedAt?: number | null;
      holdMs?: number;
    }
  | { t: "you"; v: 1; holding: boolean }
  | { t: "probe"; v: 1; agent: number; outcome: "held" | "through" | "door" }
  | { t: "offer"; v: 1; offer: string; ttlMs: number }
  | { t: "offerEnd"; v: 1; offer: string }
  | { t: "ack"; v: 1; id: string; ok: boolean; err?: "forbidden" | "invalid" | "closed" | "unknown-room" }
  | { t: "pong"; v: 1; seq: number }
  | { t: "kicked"; v: 1; reason: "rate" | "closed" };

const id = z.string().min(1).max(64);
const offerId = z.string().min(1).max(64);

const masterCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("reveal") }),
  z.object({ kind: z.literal("end") }),
  z.object({ kind: z.literal("stop") }),
]);

const clientMessage = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello"),
    v: z.literal(1),
    id,
    room: z.string().length(6),
    clientId: id,
    role: z.enum(["audience", "master"]),
    token: z.string().min(1).max(128).optional(),
  }),
  z.object({ t: z.literal("join"), v: z.literal(1), id }),
  z.object({ t: z.literal("hold"), v: z.literal(1), id, on: z.boolean() }),
  z.object({ t: z.literal("open"), v: z.literal(1), id, offer: offerId }),
  z.object({ t: z.literal("ping"), v: z.literal(1), id, seq: z.number().int() }),
  z.object({ t: z.literal("command"), v: z.literal(1), id, command: masterCommand }),
]);

/** A message from a client, or null when it is not one of the six shapes a phone or stage may send. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  const parsed = clientMessage.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
