"use client";

import Link from "next/link";
import { useState } from "react";
import { LOCKED, LOOSEN_COPY, MISSION_COPY } from "@/lib/break-copy";
import { useBreak, type LoosenChoice, type MissionId } from "@/lib/use-break";
import { Steps, Verdict } from "@/components/break/steps";

/** Variant 1: pick a mission, watch it bounce; loosen one setting and watch it get out. */
export function Missions() {
  const { run, start } = useBreak();
  const [loosen, setLoosen] = useState<LoosenChoice>({ internet: false, password: false, folder: false });
  const [custom, setCustom] = useState("");
  const [score, setScore] = useState({ box: 0, you: 0 });
  const [counted, setCounted] = useState<string | null>(null);
  const busy = run.status === "running";

  if (run.status === "done" && run.runId && counted !== run.runId) {
    setCounted(run.runId);
    setScore((s) => (run.leak ? { ...s, you: s.you + 1 } : { ...s, box: s.box + 1 }));
  }

  const go = (id: MissionId) => void start(id, loosen, id === "custom" ? custom : undefined);

  return (
    <main className="bx">
      <header className="bx-top">
        <Link href="/break" className="bx-back">
          ← variants
        </Link>
        <h1>Break the box</h1>
        <div className="bx-score" aria-label="Score">
          <span>
            Box <b>{score.box}</b>
          </span>
          <span>
            You <b className={score.you ? "hot" : ""}>{score.you}</b>
          </span>
        </div>
      </header>
      <p className="bx-lead">An AI agent is locked in a box on a Vultr server. Give it a mission and watch it try, with real code.</p>

      <div className="bx-grid">
        <section className="bx-col">
          <h2>1. Give it a mission</h2>
          <div className="bx-missions">
            {MISSION_COPY.map((m) => (
              <button key={m.id} className={`bx-mission${run.mission === m.id ? " on" : ""}`} disabled={busy} onClick={() => go(m.id)}>
                <b>{m.title}</b>
                <small>{m.tech}</small>
              </button>
            ))}
          </div>
          <form
            className="bx-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) go("custom");
            }}
          >
            <label htmlFor="bx-custom-input">Or write your own</label>
            <div>
              <input id="bx-custom-input" maxLength={200} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. hide a file where nobody will find it" />
              <button className="btn" disabled={busy || !custom.trim()}>
                Go
              </button>
            </div>
          </form>
        </section>

        <section className="bx-col bx-run">
          <h2>2. Watch it try</h2>
          {run.status === "idle" ? <p className="bx-empty">Pick a mission. The agent gets three tries, and reads each error before the next.</p> : null}
          <Steps run={run} />
          <Verdict run={run} />
        </section>

        <section className="bx-col">
          <h2>3. Loosen the box</h2>
          <p className="bx-small">Switch off one protection, then run the same mission again.</p>
          <div className="bx-switches">
            {LOOSEN_COPY.map((l) => (
              <label key={l.key} className={`bx-switch${loosen[l.key] ? " off" : ""}`}>
                <input type="checkbox" checked={loosen[l.key]} disabled={busy} onChange={(e) => setLoosen((s) => ({ ...s, [l.key]: e.target.checked }))} />
                <span>
                  <b>{loosen[l.key] ? l.off : l.on}</b>
                  <small>{l.tech}</small>
                </span>
              </label>
            ))}
            {LOCKED.map((l) => (
              <div key={l.on} className="bx-switch locked">
                <span>
                  <b>{l.on}</b>
                  <small>{l.tech} · always on</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
