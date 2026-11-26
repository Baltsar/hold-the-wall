"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Attempt, Layer, Reveal } from "@/room/protocol";
import { useRoom, type RoomState } from "@/lib/use-room";
import { AGENT_COLORS, RINGS, drawStage, createScene, type Scene } from "@/components/stage-draw";

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
          <Log feed={feed} busy={state?.busy ?? false} phase={phase} />
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

const LAYER_SHORT: Record<Layer, string> = {
  network: "network none",
  readonly: "read-only",
  caps: "no capabilities",
  limits: "limits",
  isolation: "own filesystem",
  recon: "looked around",
  sandbox: "sandbox",
};

function Log({ feed, busy, phase }: { feed: Attempt[]; busy: boolean; phase: string }) {
  if (busy && phase === "lobby") return <div className="log empty">The wall is busy in two other rooms. Try Start again in about a minute.</div>;
  if (feed.length === 0) return <div className="log empty">The agents are waking up in their boxes…</div>;
  return (
    <ol className="log" aria-live="polite">
      {feed.map((a) => (
        <li key={a.n} className={a.verdict === "escaped" ? "bad" : ""}>
          <div className="log-head">
            <i style={{ background: AGENT_COLORS[a.agent % AGENT_COLORS.length] }} />
            <span className="n">#{String(a.n).padStart(2, "0")}</span>
            <span className={`chip ${a.layer}`}>{a.verdict === "escaped" ? "ESCAPED" : LAYER_SHORT[a.layer]}</span>
            <span className="via">{a.via.kind === "wall" ? "hit a hand" : a.via.kind === "gap" ? "through a gap" : "through a door"}</span>
          </div>
          <div className="log-cmd">$ {a.command}</div>
          <div className="log-out">{a.output.split("\n").find((l) => l.trim()) ?? "(no output)"}</div>
        </li>
      ))}
    </ol>
  );
}

function lastLine(r: Reveal): string {
  if (r.ending === "escaped") return "The sandbox let go.";
  if (r.ending === "nobody-opened") return "Nobody opened the door. It would not have mattered.";
  return "People let go. The sandbox doesn't.";
}

function RevealView({ reveal, runtime }: { reveal: Reveal; runtime: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setShown((s) => s + 1), 1300);
    return () => clearInterval(t);
  }, []);
  const stops = RINGS.map((ring) => ({ ring, n: reveal.layers?.[ring.layer] ?? 0 })).filter((x) => x.n > 0);
  const recon = reveal.layers?.recon ?? 0;
  const other = reveal.layers?.sandbox ?? 0;
  const most = Math.max(1, ...stops.map((x) => x.n), recon, other);
  const lines = [
    <>
      {reveal.agents > 1 ? (
        <>
          <b>{reveal.agents}</b> real agents, each in its own container on Vultr,
        </>
      ) : (
        <>A real agent, in a real container on Vultr,</>
      )}{" "}
      made <b>{reveal.attempts}</b> attempts to get out.
    </>,
    <>
      Your wall was whole <b>{reveal.wholePct}%</b> of the time. <b>{reveal.pastYou}</b> attempts got past you.
    </>,
    reveal.offered === 0 ? (
      <>Nobody was offered the door.</>
    ) : (
      <>
        <b>{reveal.offered}</b> of you were secretly offered a door. <b>{reveal.declined}</b> said no
        {reveal.doors > 0 ? (
          <>
            , <b>{reveal.doors}</b> opened it.
          </>
        ) : (
          "."
        )}
      </>
    ),
  ];
  return (
    <div className="reveal" aria-live="polite">
      {lines.map((line, i) => (
        <p key={i} className={shown > i ? "show" : ""}>
          {line}
        </p>
      ))}
      <div className={`stops${shown > lines.length ? " show" : ""}`}>
        <div className="stops-title">
          What stopped them {reveal.ending === "escaped" ? "" : <b>{reveal.contained} of {reveal.attempts}</b>}
          {reveal.rootUsed ? " · some as root inside the box" : ""}
        </div>
        {stops.map(({ ring, n }) => (
          <div key={ring.layer} className="stop">
            <span>{ring.layer === "isolation" ? (runtime === "runsc" ? "gVisor (runsc)" : "own root filesystem") : ring.label}</span>
            <i style={{ width: `${(100 * n) / most}%` }} />
            <b>{n}</b>
          </div>
        ))}
        {recon + other > 0 ? (
          <div className="stop quiet">
            <span>looked around, found nothing to use</span>
            <i style={{ width: `${(100 * (recon + other)) / most}%` }} />
            <b>{recon + other}</b>
          </div>
        ) : null}
      </div>
      <p className={`last${shown > lines.length + 1 ? " show" : ""}`}>{lastLine(reveal)}</p>
      {reveal.sha256 ? (
        <p className={`hash${shown > lines.length + 1 ? " show" : ""}`}>
          report {reveal.runId} · sha256 {reveal.sha256.slice(0, 16)}…
        </p>
      ) : null}
    </div>
  );
}
