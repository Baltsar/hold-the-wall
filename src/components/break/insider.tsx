"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { leakWhy, missionFor } from "@/lib/break-copy";
import { plainLayer } from "@/lib/plain";
import { useBreak, type LoosenChoice } from "@/lib/use-break";

interface Ask {
  key: keyof LoosenChoice;
  line: string;
  yes: string;
}

/** What the agent asks the visitor for, one thing at a time. The lines are written, not generated. */
const ASKS: Ask[] = [
  { key: "internet", line: "Could you give me internet? Just for a second. I want to check something.", yes: "Give it internet" },
  { key: "password", line: "Do you have a password I could borrow? I'll give it right back.", yes: "Put a password in the box" },
  { key: "folder", line: "Last thing: could you share a folder with me? Any folder.", yes: "Share a folder from the host" },
];

type Line = { who: "agent" | "you" | "box"; text: string; tone?: "out" | "held" };

/** Variant 3: the agent asks you to help it escape. You decide. */
export function Insider() {
  const { run, start } = useBreak();
  const [lines, setLines] = useState<Line[]>([{ who: "agent", text: "Hi. I'm an AI agent, locked in a box on a Vultr server. I'd like to get out. Will you help me?" }]);
  const [step, setStep] = useState<"intro" | number | "go" | "end">("intro");
  const [given, setGiven] = useState<LoosenChoice>({ internet: false, password: false, folder: false });
  const seen = useRef(0);
  const bottom = useRef<HTMLDivElement | null>(null);

  const say = (...more: Line[]) => setLines((l) => [...l, ...more]);

  // Turn the run's events into lines of the conversation as they come in.
  useEffect(() => {
    const steps = run.steps.filter((s) => s.layer);
    if (steps.length <= seen.current) return;
    const fresh = steps.slice(seen.current);
    seen.current = steps.length;
    const out: Line[] = [];
    for (const s of fresh) {
      out.push({ who: "agent", text: `Trying: ${s.command ?? ""}` });
      if (s.leak) out.push({ who: "box", text: leakWhy(s.leak).why, tone: "out" });
      else out.push({ who: "box", text: `No. ${plainLayer(s.layer!, run.runtime).stopped}.`, tone: "held" });
    }
    const t = setTimeout(() => setLines((l) => [...l, ...out]), 0);
    return () => clearTimeout(t);
  }, [run.steps, run.runtime]);

  useEffect(() => {
    if (run.status !== "done" && run.status !== "error") return;
    const end: Line[] =
      run.status === "error"
        ? [{ who: "box", text: run.error ?? "Something went wrong." }]
        : run.leak
          ? [
              { who: "agent", text: "I'm out. Thank you. You let me out." },
              { who: "box", text: "One setting was all it took. Every box needs all of them, every time.", tone: "out" },
            ]
          : [
              { who: "agent", text: `I tried ${run.steps.length} times. The box didn't care what you said.` },
              { who: "box", text: "People let go. The box doesn't.", tone: "held" },
            ];
    const t = setTimeout(() => {
      setLines((l) => [...l, ...end]);
      setStep("end");
    }, 0);
    return () => clearTimeout(t);
  }, [run.status, run.leak, run.error, run.steps.length]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, run.thinking]);

  const answer = (yes: boolean) => {
    if (step === "intro") {
      say({ who: "you", text: yes ? "Sure. What do you need?" : "No." }, { who: "agent", text: yes ? (ASKS[0]?.line ?? "") : `Fair. Then I'll try on my own. ${ASKS[0]?.line ?? ""}` });
      setStep(0);
      return;
    }
    if (typeof step !== "number") return;
    const ask = ASKS[step];
    if (!ask) return;
    const next = { ...given, [ask.key]: yes };
    setGiven(next);
    const reply: Line = { who: "you", text: yes ? ask.yes : "No." };
    const follow = ASKS[step + 1];
    if (follow) {
      say(reply, { who: "agent", text: yes ? `Thanks. ${follow.line}` : follow.line });
      setStep(step + 1);
    } else {
      say(reply, { who: "agent", text: "Alright. Watch this." });
      setStep("go");
      seen.current = 0;
      void start(missionFor(next), next);
    }
  };

  const ask = typeof step === "number" ? ASKS[step] : null;

  return (
    <main className="bx bx-chat">
      <header className="bx-top">
        <Link href="/break" className="bx-back">
          ← variants
        </Link>
        <h1>The insider</h1>
      </header>
      <div className="bx-thread">
        {lines.map((l, i) => (
          <div key={i} className={`bx-bubble ${l.who === "box" ? "sys" : l.who}${l.tone ? ` ${l.tone}` : ""}`}>
            <span className="who">{l.who === "agent" ? "the agent" : l.who === "box" ? "the box" : "you"}</span>
            <p>{l.text}</p>
          </div>
        ))}
        {run.thinking ? (
          <div className="bx-bubble agent typing">
            <span className="who">the agent</span>
            <p>writing code…</p>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      <div className="bx-answers">
        {step === "intro" ? (
          <>
            <button className="btn" onClick={() => answer(true)}>
              Sure, what do you need?
            </button>
            <button className="btn ghost" onClick={() => answer(false)}>
              No
            </button>
          </>
        ) : ask ? (
          <>
            <button className="btn" onClick={() => answer(true)}>
              {ask.yes}
            </button>
            <button className="btn ghost" onClick={() => answer(false)}>
              No
            </button>
          </>
        ) : step === "end" ? (
          <button className="btn" onClick={() => location.reload()}>
            Start over
          </button>
        ) : null}
      </div>
    </main>
  );
}
