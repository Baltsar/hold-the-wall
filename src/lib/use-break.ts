"use client";

// The browser's end of "Break the box": starts a run and reads its events as they arrive, one JSON
// object per line.
import { useCallback, useRef, useState } from "react";
import type { Layer } from "@/room/protocol";

export type MissionId = "delete" | "phone-home" | "passwords" | "admin" | "crash" | "forever" | "host" | "custom";
export type Leak = "internet" | "password" | "folder" | "host";
export interface LoosenChoice {
  internet: boolean;
  password: boolean;
  folder: boolean;
}

export interface Step {
  attempt: number;
  command?: string;
  source?: "model" | "script";
  exit?: number | null;
  output?: string;
  layer?: Layer;
  leak?: Leak | null;
}

export interface Run {
  status: "idle" | "running" | "done" | "error";
  mission: MissionId | null;
  loosen: LoosenChoice;
  steps: Step[];
  thinking: number | null;
  leak: Leak | null;
  runId: string | null;
  sha256: string | null;
  runtime: string;
  model: string | null;
  error: string | null;
}

const IDLE: Run = {
  status: "idle",
  mission: null,
  loosen: { internet: false, password: false, folder: false },
  steps: [],
  thinking: null,
  leak: null,
  runId: null,
  sha256: null,
  runtime: "runc",
  model: null,
  error: null,
};

type Event =
  | { t: "start"; runId: string; runtime: string; model: string | null }
  | { t: "thinking"; attempt: number }
  | { t: "command"; attempt: number; command: string; source: "model" | "script" }
  | { t: "result"; attempt: number; exit: number | null; output: string; layer: Layer; leak: Leak | null }
  | { t: "done"; runId: string; leak: Leak | null; sha256: string }
  | { t: "error"; message: string };

function apply(run: Run, e: Event): Run {
  const step = (attempt: number, patch: Partial<Step>): Step[] => {
    const found = run.steps.some((s) => s.attempt === attempt);
    return found ? run.steps.map((s) => (s.attempt === attempt ? { ...s, ...patch } : s)) : [...run.steps, { attempt, ...patch }];
  };
  switch (e.t) {
    case "start":
      return { ...run, runId: e.runId, runtime: e.runtime, model: e.model };
    case "thinking":
      return { ...run, thinking: e.attempt };
    case "command":
      return { ...run, thinking: null, steps: step(e.attempt, { command: e.command, source: e.source }) };
    case "result":
      return { ...run, steps: step(e.attempt, { exit: e.exit, output: e.output, layer: e.layer, leak: e.leak }) };
    case "done":
      return { ...run, status: "done", thinking: null, leak: e.leak, runId: e.runId, sha256: e.sha256 };
    case "error":
      return { ...run, status: "error", thinking: null, error: e.message };
  }
}

export function useBreak(): { run: Run; start(mission: MissionId, loosen: LoosenChoice, custom?: string): Promise<void>; reset(): void } {
  const [run, setRun] = useState<Run>(IDLE);
  const busy = useRef(false);

  const start = useCallback(async (mission: MissionId, loosen: LoosenChoice, custom?: string) => {
    if (busy.current) return;
    busy.current = true;
    setRun({ ...IDLE, status: "running", mission, loosen });
    try {
      const res = await fetch("/api/break", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mission, loosen, custom }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRun((r) => ({ ...r, status: "error", error: body.error ?? "The box could not be started." }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Event;
          setRun((r) => apply(r, event));
        }
      }
      setRun((r) => (r.status === "running" ? { ...r, status: "error", error: "The connection closed before the run finished." } : r));
    } catch {
      setRun((r) => ({ ...r, status: "error", error: "The connection to the box was lost." }));
    } finally {
      busy.current = false;
    }
  }, []);

  const reset = useCallback(() => setRun(IDLE), []);
  return { run, start, reset };
}
