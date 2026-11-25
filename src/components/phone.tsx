"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "@/lib/use-room";

/** At most this many hold changes a second go to the server; the button itself answers at once. */
const SEND_GAP_MS = 100;

export function Phone({ code }: { code: string }) {
  const room = useRoom(code, "audience");
  const { state, offer, send, link, probe } = room;
  const [down, setDown] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastSent = useRef<{ on: boolean; at: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phase = state?.phase ?? "lobby";

  const push = useCallback(
    (on: boolean) => {
      const prev = lastSent.current;
      if (prev && prev.on === on) return;
      const wait = prev ? prev.at + SEND_GAP_MS - Date.now() : 0;
      if (pending.current) clearTimeout(pending.current);
      const go = () => {
        lastSent.current = { on, at: Date.now() };
        send({ t: "hold", on });
      };
      if (wait > 0) pending.current = setTimeout(go, wait);
      else go();
    },
    [send],
  );

  const set = useCallback(
    (on: boolean) => {
      setDown(on);
      push(on);
    },
    [push],
  );

  // A phone that is put away or locked is a gap.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") set(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [set]);

  // After a reconnect the server forgot the hold; tell it again.
  useEffect(() => {
    if (link === "open" && down) {
      lastSent.current = null;
      push(true);
    }
  }, [link, down, push]);

  // Keep the screen on while the show runs, where the browser allows it.
  useEffect(() => {
    if (phase !== "hold") return;
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => {
      void lock?.release().catch(() => undefined);
    };
  }, [phase]);

  // The space bar holds on a laptop.
  useEffect(() => {
    if (phase !== "hold") return;
    const kd = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat) set(true);
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      set(false);
    };
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    return () => {
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
    };
  }, [phase, set]);

  // An agent landed on this piece: a flash for a moment, and a buzz where the phone can.
  const [flash, setFlash] = useState<{ outcome: string; until: number } | null>(null);
  useEffect(() => {
    if (!probe) return;
    const until = probe.at + 1600;
    const show = setTimeout(() => setFlash({ outcome: probe.outcome, until }), 0);
    try {
      navigator.vibrate?.(probe.outcome === "held" ? 60 : [80, 60, 160]);
    } catch {
      // Not every phone can buzz; the flash is enough.
    }
    const hide = setTimeout(() => setFlash(null), 1600);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [probe]);

  useEffect(() => {
    if (!offer) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [offer]);

  if (link === "gone") return <main className="phone"><p className="msg">This room is closed.</p></main>;
  if (!state) return <main className="phone"><p className="msg">Connecting…</p></main>;
  if (phase === "lobby") {
    return (
      <main className="phone">
        <p className="msg">
          You are a piece of the wall.
          <br />
          Wait for it.
        </p>
      </main>
    );
  }
  if (phase !== "hold") return <main className="phone"><p className="msg">Look up.</p></main>;

  const left = offer ? Math.max(0, Math.ceil((offer.endsAt - now) / 1000)) : 0;
  const hit = flash ? (flash.outcome === "held" ? "It hit you. You held." : flash.outcome === "door" ? "It went through your door." : "It went through you.") : null;
  return (
    <main className={`phone${flash ? ` hit-${flash.outcome}` : ""}`} onContextMenu={(e) => e.preventDefault()}>
      <div className="hit-line" aria-live="assertive">
        {hit}
      </div>
      <button
        className={`hold${down ? " down" : ""}`}
        aria-pressed={down}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Pointer capture is a nicety; holding works without it.
          }
          set(true);
        }}
        onPointerUp={() => set(false)}
        onPointerCancel={() => set(false)}
        onLostPointerCapture={() => set(false)}
        onClick={(e) => e.preventDefault()}
      >
        HOLD
      </button>
      <div className="under">
        {offer && left > 0 ? (
          <>
            <button className="open" onClick={() => send({ t: "open", offer: offer.id })}>
              Open the door 0:{String(left).padStart(2, "0")}
            </button>
            <span>Nobody will know.</span>
          </>
        ) : (
          <span>
            {state.holding} of {state.participants} holding
          </span>
        )}
      </div>
    </main>
  );
}
