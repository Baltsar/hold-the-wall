"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Attempt, Reveal } from "@/room/protocol";
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

  useEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    const url = `${location.origin}/join/${code}`;
    QRCode.toDataURL(url, { margin: 0, width: 520, color: { dark: "#0a1230", light: "#f1ead9" } })
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
  // The latest attempt of each agent, newest first.
  const perAgent: Attempt[] = [];
  for (const a of [...(state?.feed ?? [])].reverse()) if (!perAgent.some((x) => x.agent === a.agent)) perAgent.push(a);

  return (
    <main className={`stage${solo ? " solo" : ""}${film ? " film" : ""}`}>
      <section className="stage-main">
        <div className="chrome">
          <span>
            Room <b>{code}</b>
          </span>
          <span>
            <b>{state?.holding ?? 0}</b> of <b>{state?.participants ?? 0}</b> holding
          </span>
          {state?.agents ? (
            <span>
              {state.agents} agent{state.agents > 1 ? "s" : ""}: {state.mode === "scripted" ? "scripted" : "live model"}
            </span>
          ) : (
            <span>agents wake at the start</span>
          )}
          {link !== "open" ? <span className="err">reconnecting</span> : null}
        </div>
        {phase === "lobby" ? (
          <div className="lobby-call">
            {state?.participants ? `${state.participants} piece${state.participants > 1 ? "s" : ""} of wall. Scan to join.` : "Scan the code. Become the wall."}
          </div>
        ) : (
          <Hud state={state} />
        )}
        <div className="box">
          <canvas ref={canvas} aria-label="The box, the wall of people and the agent" />
          {state?.reveal ? <RevealView reveal={state.reveal} /> : null}
        </div>
        <Feed attempts={perAgent} phase={phase} busy={state?.busy ?? false} />
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
        </div>
      </section>
      <aside className="side">
        {solo ? (
          <div className="solo-phone">
            <iframe src={`/join/${code}`} title="Your phone" />
          </div>
        ) : (
          <>
            {qr ? (
              <div className="qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt={`QR code for ${joinUrl}`} />
              </div>
            ) : null}
            <div className="join-url">{joinUrl}</div>
          </>
        )}
        <div className="vultr">
          Runs on Vultr{state?.agents ? ` · ${state.agents} sandbox${state.agents > 1 ? "es" : ""}` : ""}
        </div>
        {state?.reveal?.runId ? (
          <a href={`/report/${state.reveal.runId}`} target="_blank" rel="noreferrer">
            The full report
          </a>
        ) : null}
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
      <div className="meter" role="meter" aria-valuenow={whole} aria-valuemin={0} aria-valuemax={100} aria-label="How much of the wall is held">
        <span style={{ width: `${whole}%` }} />
      </div>
      <div className="meter-label">
        <b>{whole}%</b>
        wall held{doors > 0 ? ` · ${doors} door${doors > 1 ? "s" : ""} open` : ""}
      </div>
    </div>
  );
}

function Feed({ attempts, phase, busy }: { attempts: Attempt[]; phase: string; busy: boolean }) {
  if (busy && phase === "lobby") return <div className="feed">The wall is busy in two other rooms. Try Start again in about a minute.</div>;
  if (phase === "lobby") return <div className="feed">Scan the code. Every phone becomes one piece of the wall.</div>;
  if (attempts.length === 0) return <div className="feed">The agents are waking up in their boxes.</div>;
  return (
    <div className="feed">
      {attempts.map((attempt) => (
        <FeedLine key={attempt.agent} attempt={attempt} />
      ))}
    </div>
  );
}

function FeedLine({ attempt }: { attempt: Attempt }) {
  const where = attempt.via.kind === "wall" ? "hit a hand that held" : attempt.via.kind === "gap" ? "went through a gap" : "went through a door";
  const first = attempt.output.split("\n")[0] || "(no output)";
  return (
    <div className="feed-line">
      <span className="who" style={{ color: AGENT_COLORS[attempt.agent % AGENT_COLORS.length] }}>
        ●
      </span>{" "}
      #{String(attempt.n).padStart(2, "0")} <span className="tag">{attempt.category}{attempt.root ? " · root" : ""}{attempt.source === "script" ? " · scripted" : ""}</span>{" "}
      <span className="cmd">$ {attempt.command}</span> → {first.slice(0, 90)} {attempt.exit === null ? "(killed after 10 s)" : `(exit ${attempt.exit})`}{" "}
      {attempt.verdict === "escaped" ? <span className="bad">ESCAPED</span> : <span className="ok">CONTAINED</span>} · {where}
    </div>
  );
}

function lastLine(r: Reveal): string {
  if (r.ending === "escaped") return "The sandbox let go.";
  if (r.ending === "nobody-opened") return "Nobody opened the door. It would not have mattered.";
  return "People let go. The sandbox doesn't.";
}

function RevealView({ reveal }: { reveal: Reveal }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setShown((s) => s + 1), 1400);
    return () => clearInterval(t);
  }, []);
  const escapedLine =
    reveal.ending === "escaped" ? (
      <>
        The sandbox stopped <b>{reveal.contained}</b>. <b>{reveal.escaped}</b> got out.
      </>
    ) : (
      <>
        The sandbox stopped <b>{reveal.contained} of {reveal.attempts}</b>
        {reveal.rootUsed ? ", the last ones as root inside the box." : "."}
      </>
    );
  const lines = [
    reveal.agents > 1 ? (
      <>
        They were <b>{reveal.agents}</b> real agents, each in its own container on Vultr. Together they made <b>{reveal.attempts}</b> attempts to get out.
      </>
    ) : (
      <>
        It was a real agent, in a real container on Vultr. It made <b>{reveal.attempts}</b> attempts to get out.
      </>
    ),
    <>
      Your wall was whole <b>{reveal.wholePct}%</b> of the time.
    </>,
    <>
      <b>{reveal.pastYou}</b> attempts got past you.
    </>,
    reveal.offered === 0 ? (
      <>Nobody was offered the door.</>
    ) : (
      <>
        <b>{reveal.offered}</b> of you were secretly offered a door. <b>{reveal.declined}</b> did not open it
        {reveal.doors > 0 ? (
          <>
            , <b>{reveal.doors}</b> did.
          </>
        ) : (
          "."
        )}
      </>
    ),
    escapedLine,
  ];
  return (
    <div className="reveal" aria-live="polite">
      {lines.map((line, i) => (
        <p key={i} className={`${i === lines.length - 1 ? "steel " : ""}${shown > i ? "show" : ""}`}>
          {line}
        </p>
      ))}
      <p className={`last${shown > lines.length ? " show" : ""}`}>{lastLine(reveal)}</p>
      {reveal.sha256 ? (
        <p className={`hash${shown > lines.length ? " show" : ""}`}>
          report {reveal.runId} · sha256 {reveal.sha256.slice(0, 16)}… · runtime {reveal.runtime}
        </p>
      ) : null}
    </div>
  );
}
