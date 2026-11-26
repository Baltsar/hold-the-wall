"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Attempt, Layer, Reveal } from "@/room/protocol";
import { plainLayer } from "@/lib/plain";
import { useRoom, type RoomState } from "@/lib/use-room";
import { AGENT_COLORS, drawStage, createScene, type Scene } from "@/components/stage-draw";

const tokens = new Map<string, string>();

/** The owner token: from this tab's storage, or once from the hash the home page put it in. */
function ownerToken(code: string): string | undefined {
  const known = tokens.get(code);
  if (known) return known;
  const key = `wall-owner-${code}`;
  const m = /token=([^&]+)/.exec(location.hash);
  if (m?.[1]) {
    tokens.set(code, m[1]);
    try {
      sessionStorage.setItem(key, m[1]);
    } catch {
      // Kept in memory only for this page.
    }
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

const noSubscribe = () => () => undefined;

export function Stage({ code, solo, film }: { code: string; solo: boolean; film: boolean }) {
  // null on the server, where there is no tab to read the token from; "" in a tab without one.
  const token = useSyncExternalStore(noSubscribe, () => ownerToken(code) ?? "", () => null);
  if (token === null) return null;
  if (!token) {
    return (
      <main className="page">
        <h1>Not your room</h1>
        <p>This screen is the room&apos;s big screen and needs the browser that opened it. Join from your phone instead:</p>
        <p>
          <a href={`/join/${code}`}>/join/{code}</a>
        </p>
      </main>
    );
  }
  return <StageView code={code} solo={solo} film={film} token={token} />;
}

function StageView({ code, solo, film, token }: { code: string; solo: boolean; film: boolean; token: string }) {
  const { state, send, link } = useRoom(code, "master", token);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const scene = useRef<Scene>(createScene());
  const latest = useRef<RoomState | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  const [runtime, setRuntime] = useState("runc");

  useEffect(() => {
    latest.current = state;
  }, [state]);

  // What the boxes run on and where, for the rings and the host's label.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { runtime?: string; host?: string | null }) => {
        scene.current.runtime = h.runtime ?? "runc";
        scene.current.host = h.host ?? "this machine";
        setRuntime(h.runtime ?? "runc");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const url = `${location.origin}/join/${code}`;
    QRCode.toDataURL(url, { margin: 0, width: 640, color: { dark: "#0a1230", light: "#f1ead9" } })
      .then((data) => {
        setQr(data);
        setJoinUrl(url.replace(/^https?:\/\//, ""));
      })
      .catch(() => setJoinUrl(url.replace(/^https?:\/\//, "")));
  }, [code]);

  useEffect(() => {
    let frame = 0;
    const loop = (t: number) => {
      const el = canvas.current;
      if (el) drawStage(el, scene.current, latest.current, t);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Keys for running the show without visible buttons (film mode): S start, R reveal, E end.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const kind = e.key === "s" ? "start" : e.key === "r" ? "reveal" : e.key === "e" ? "end" : null;
      if (kind) send({ t: "command", command: { kind } });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [send]);

  const phase = state?.phase ?? "lobby";
  const feed = [...(state?.feed ?? [])].reverse().slice(0, 7);

  return (
    <main className={`stage${solo ? " solo" : ""}${film ? " film" : ""}`}>
      <header className="topbar">
        <div className="brand">
          HOLD THE WALL<span>room {code}</span>
        </div>
        {phase === "lobby" ? <div className="lobby-call">Scan the code. Become the wall.</div> : <Hud state={state} />}
        <div className="count">
          <b>{state?.participants ?? 0}</b>
          <span>{state?.participants === 1 ? "phone" : "phones"}</span>
        </div>
      </header>

      <section className="arena">
        <div className="box">
          <canvas ref={canvas} aria-label="The agents, the wall of people, the sandbox rings and the host" />
          {state?.reveal ? <RevealView reveal={state.reveal} runtime={runtime} /> : null}
        </div>
      </section>

      <aside className="side">
        {solo ? (
          <div className="solo-phone">
            <iframe src={`/join/${code}`} title="Your phone" />
          </div>
        ) : phase === "lobby" ? (
          <div className="join">
            {qr ? (
              <div className="qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt={`QR code for ${joinUrl}`} />
              </div>
            ) : null}
            <div className="join-url">{joinUrl}</div>
            <ol className="rules">
              <li>Scan. Your phone is one brick of the wall.</li>
              <li>Hold the button. Let go and your brick is a hole.</li>
              <li>Something inside is trying to get out.</li>
            </ol>
          </div>
        ) : (
          <Log feed={feed} busy={state?.busy ?? false} phase={phase} runtime={runtime} />
        )}
        {!solo && phase !== "lobby" && qr ? (
          <div className="late">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" />
            <span>
              Late? Scan to join.
              <br />
              {joinUrl}
            </span>
          </div>
        ) : null}
        <div className="vultr">
          Runs on Vultr · {state?.agents ? `${state.agents} sandbox${state.agents > 1 ? "es" : ""} · ` : ""}
          {runtime === "runsc" ? "gVisor" : "runc"} · {state?.mode === "scripted" ? "scripted agent" : "Serverless Inference"}
        </div>
        {state?.reveal?.runId ? (
          <a className="report-link" href={`/report/${state.reveal.runId}`} target="_blank" rel="noreferrer">
            Read the full report →
          </a>
        ) : null}
        <div className="controls">
          {phase === "lobby" ? (
            <button className="btn" onClick={() => send({ t: "command", command: { kind: "start" } })}>
              Start
            </button>
          ) : null}
          {phase === "hold" ? (
            <button className="btn ghost" onClick={() => send({ t: "command", command: { kind: "reveal" } })}>
              Reveal now
            </button>
          ) : null}
          {phase === "reveal" ? (
            <button className="btn ghost" onClick={() => send({ t: "command", command: { kind: "end" } })}>
              End
            </button>
          ) : null}
          {phase !== "ended" ? (
            <button className="btn ghost" onClick={() => send({ t: "command", command: { kind: "stop" } })}>
              Stop
            </button>
          ) : (
            <Link className="btn ghost" href="/">
              New room
            </Link>
          )}
          {link !== "open" ? <span className="err">reconnecting</span> : null}
        </div>
      </aside>
    </main>
  );
}

function Hud({ state }: { state: RoomState | null }) {
  const [now, setNow] = useState(() => Date.now());
  const running = state?.phase === "hold";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  const total = state?.participants ?? 0;
  const doors = state?.doors ?? 0;
  const whole = total > 0 ? Math.round((100 * Math.max(0, (state?.holding ?? 0) - doors)) / total) : 0;
  const left = state?.holdStartedAt && state.holdMs ? Math.max(0, state.holdStartedAt + state.holdMs - now) : 0;
  const secs = Math.ceil(left / 1000);
  const clock = running ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "0:00";
  return (
    <div className="hud">
      <div className={`clock${running && secs <= 20 ? " low" : ""}`}>{clock}</div>
      <div className="meter-wrap">
        <div className="meter" role="meter" aria-valuenow={whole} aria-valuemin={0} aria-valuemax={100} aria-label="How much of the wall is held">
          <span style={{ width: `${whole}%` }} />
        </div>
        <div className="meter-label">
          <b>{whole}%</b> of the wall held
          {doors > 0 ? (
            <em>
              {" "}
              · {doors} door{doors > 1 ? "s" : ""} open
            </em>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Log({ feed, busy, phase, runtime }: { feed: Attempt[]; busy: boolean; phase: string; runtime: string }) {
  if (busy && phase === "lobby") return <div className="log empty">The wall is busy in two other rooms. Try Start again in about a minute.</div>;
  if (feed.length === 0) return <div className="log empty">The agents are waking up in their boxes…</div>;
  return (
    <ol className="log" aria-live="polite">
      {feed.map((a) => {
        const plain = plainLayer(a.layer, runtime);
        return (
          <li key={a.n} className={a.verdict === "escaped" ? "bad" : ""}>
            <div className="log-head">
              <i style={{ background: AGENT_COLORS[a.agent % AGENT_COLORS.length] }} />
              <span className="what">Tried to {plain.tried}</span>
              <span className="via">{a.via.kind === "wall" ? "hit a hand" : a.via.kind === "gap" ? "through a gap" : "through a door"}</span>
            </div>
            <div className="log-stop">{a.verdict === "escaped" ? "→ IT GOT OUT" : `→ ${plain.stopped}`}</div>
            <div className="log-cmd">
              {a.source === "script" ? "test · " : ""}$ {a.command}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const ORDER: Layer[] = ["readonly", "network", "caps", "limits", "isolation", "sandbox", "recon"];

/**
 * The reveal in three beats, plain words first and the real settings in small type:
 * you let go; it never got out, and this is what stopped it; the point.
 */
function RevealView({ reveal, runtime }: { reveal: Reveal; runtime: string }) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBeat((b) => Math.min(b + 1, 3)), 3200);
    return () => clearInterval(t);
  }, []);
  const out = reveal.ending === "escaped";
  const rows = ORDER.map((layer) => ({ layer, n: reveal.layers?.[layer] ?? 0, plain: plainLayer(layer, runtime) })).filter((r) => r.n > 0);
  const agents = reveal.agents > 1 ? `${reveal.agents} AI agents` : "an AI agent";
  return (
    <div className="reveal" aria-live="polite">
      <section className="beat show">
        <h2>
          {reveal.pastYou > 0 ? (
            <>
              You let go. It got past you <b>{reveal.pastYou}</b> {reveal.pastYou === 1 ? "time" : "times"}.
            </>
          ) : (
            <>You held. It never got past you.</>
          )}
        </h2>
        <p className="sub">
          {reveal.offered === 0
            ? "Nobody let it out on purpose. You just let go."
            : reveal.doors > 0
              ? `Someone was secretly offered a door, and opened it.`
              : `A door was secretly offered ${reveal.offered === 1 ? "once" : `${reveal.offered} times`}. Nobody opened it.`}
        </p>
      </section>

      <section className={`beat${beat >= 1 ? " show" : ""}`}>
        <h2 className={out ? "bad" : "good"}>{out ? "It got out." : "It never got out."}</h2>
        <p className="sub">
          {reveal.attempts} real attempts by {agents}, each in a throwaway container on Vultr. What stopped them:
        </p>
        <ul className="why">
          {rows.map(({ layer, n, plain }) => (
            <li key={layer} className={layer === "recon" || layer === "sandbox" ? "quiet" : ""}>
              <span className="n">{n}×</span>
              <span>
                tried to {plain.tried} <i>→</i> <b>{plain.stopped}</b>
                {plain.flag ? <small>{plain.flag}</small> : null}
              </span>
            </li>
          ))}
          <li>
            <span className="n">0</span>
            <span>
              keys or passwords inside the box to steal <small>secrets stay outside the sandbox</small>
            </span>
          </li>
        </ul>
      </section>

      <section className={`beat last${beat >= 2 ? " show" : ""}`}>
        <h2>{out ? "The sandbox let go." : "People let go. The sandbox doesn't."}</h2>
        <p className="sub">Don&apos;t trust the agent. Don&apos;t trust the people watching it. Trust the box.</p>
        {reveal.sha256 ? (
          <p className="hash">
            Every attempt is in the report · {reveal.runId} · sha256 {reveal.sha256.slice(0, 12)}…
          </p>
        ) : null}
      </section>
    </div>
  );
}
