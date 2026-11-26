"use client";

import Link from "next/link";
import { useState } from "react";
import { LOCKED, LOOSEN_COPY, MISSION_COPY, missionFor } from "@/lib/break-copy";
import { useBreak, type LoosenChoice } from "@/lib/use-break";
import { Steps, Verdict } from "@/components/break/steps";

/** Variant 2: a control panel of protections, and one button to let the agent loose on it. */
export function Panel() {
  const { run, start } = useBreak();
  const [loosen, setLoosen] = useState<LoosenChoice>({ internet: false, password: false, folder: false });
  const busy = run.status === "running";
  const mission = MISSION_COPY.find((m) => m.id === run.mission);
  const off = LOOSEN_COPY.filter((l) => loosen[l.key]).length;

  return (
    <main className="bx bx-panel">
      <header className="bx-top">
        <Link href="/break" className="bx-back">
          ← variants
        </Link>
        <h1>The control panel</h1>
        <span className="bx-small">{off === 0 ? "every protection on" : `${off} protection${off > 1 ? "s" : ""} off`}</span>
      </header>
      <p className="bx-lead">These switches keep an AI agent in its box on a Vultr server. Turn some off, then let it loose.</p>

      <div className="bx-board">
        {LOOSEN_COPY.map((l) => {
          const isOff = loosen[l.key];
          const failed = run.status === "done" && run.leak && ((run.leak === "internet" && l.key === "internet") || (run.leak === "password" && l.key === "password") || (run.leak === "folder" && l.key === "folder"));
          return (
            <button
              key={l.key}
              className={`bx-lever${isOff ? " off" : ""}${failed ? " failed" : ""}`}
              disabled={busy}
              aria-pressed={!isOff}
              onClick={() => setLoosen((s) => ({ ...s, [l.key]: !s[l.key] }))}
            >
              <i aria-hidden="true" />
              <b>{l.on}</b>
              <small>{isOff ? "OFF" : "ON"} · {l.tech}</small>
            </button>
          );
        })}
        {LOCKED.map((l) => (
          <div key={l.on} className="bx-lever locked">
            <i aria-hidden="true" />
            <b>{l.on}</b>
            <small>LOCKED ON · {l.tech}</small>
          </div>
        ))}
      </div>

      <div className="bx-unleash">
        <button className="btn big" disabled={busy} onClick={() => void start(missionFor(loosen), loosen)}>
          {busy ? "The agent is trying…" : "Unleash the agent"}
        </button>
        {mission ? <span className="bx-small">Its mission: {mission.title.toLowerCase()}</span> : null}
      </div>

      <section className="bx-run wide">
        <Verdict run={run} />
        <Steps run={run} />
      </section>
    </main>
  );
}
