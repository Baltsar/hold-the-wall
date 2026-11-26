"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createScene, drawStage } from "@/components/stage-draw";
import type { RoomState } from "@/lib/use-room";

/** The show key, if the team opened this page with `#show=<key>`. Kept out of the URL sent to the server. */
function showKey(): string | null {
  const m = /(?:^#|&)show=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1] ?? "") : null;
}

/**
 * A still picture of the world for the start page: the same drawing as the stage, fed a made-up room
 * with a few bricks out. Nothing here runs a command; it says so under the picture.
 */
function usePreview(canvas: React.RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const scene = createScene();
    scene.host = "vultr · sto · vc2-2c-4gb";
    scene.runtime = "runsc";
    let wall = "1111110111111111011111101111";
    const state: RoomState = {
      t: "state",
      v: 1,
      seq: 1,
      code: "DEMO00",
      phase: "hold",
      participants: wall.length,
      holding: 25,
      mode: "live",
      busy: false,
      wall,
      doors: 0,
      agents: 2,
      feed: [],
    };
    let frame = 0;
    let flip = 0;
    const loop = (t: number) => {
      // Now and then one brick lets go and another comes back, so the picture breathes.
      if (t - flip > 1400) {
        flip = t;
        const i = Math.floor(Math.random() * wall.length);
        wall = wall.slice(0, i) + (wall[i] === "1" ? "0" : "1") + wall.slice(i + 1);
        state.wall = wall;
      }
      if (canvas.current) drawStage(canvas.current, scene, state, t);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [canvas]);
}

export function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  usePreview(canvas);

  async function open(solo: boolean) {
    setBusy(true);
    setError(null);
    try {
      const key = showKey();
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { "x-show-key": key } : {}) },
        body: JSON.stringify({ solo }),
      });
      const body = (await res.json()) as { code?: string; ownerToken?: string; error?: string };
      if (!res.ok || !body.code || !body.ownerToken) throw new Error(body.error ?? "The room could not be opened.");
      try {
        sessionStorage.setItem(`wall-owner-${body.code}`, body.ownerToken);
      } catch {
        // Without storage the token rides in the hash, read once by the stage.
      }
      router.push(`/stage/${body.code}${solo ? "?solo=1" : ""}#token=${body.ownerToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The room could not be opened.");
      setBusy(false);
    }
  }

  return (
    <main className="home">
      <section className="home-text">
        <p className="eyebrow">A social experiment with a real AI agent</p>
        <h1>Hold the Wall</h1>
        <p className="lead">
          Something in the box is trying to get out. You and everyone in the room are the wall around it: one brick per phone. Hold your
          brick.
        </p>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => open(true)}>
            Try it alone
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => open(false)}>
            Start a room
          </button>
        </div>
        {error ? <p className="err">{error}</p> : null}
        <dl className="facts-list">
          <div>
            <dt>The agent</dt>
            <dd>A real model on Vultr Serverless Inference, running real shell commands to get out.</dd>
          </div>
          <div>
            <dt>The box</dt>
            <dd>A throwaway container on a Vultr VM: no network, read-only, no capabilities, hard limits, gVisor.</dd>
          </div>
          <div>
            <dt>The proof</dt>
            <dd>Every attempt, its command and what came back, in a report with a hash.</dd>
          </div>
        </dl>
        <p className="muted">&quot;Try it alone&quot; puts the big screen and your phone side by side. &quot;Start a room&quot; shows a QR code for everyone around you. About four minutes.</p>
      </section>
      <figure className="home-picture">
        <canvas ref={canvas} aria-label="The layers: agents in the middle, a wall of people, the sandbox rings, the host" />
        <figcaption>The layers, inside out: agents, people, the sandbox, the host. A picture: nothing runs until you start.</figcaption>
      </figure>
    </main>
  );
}
