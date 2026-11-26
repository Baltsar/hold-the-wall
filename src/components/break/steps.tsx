"use client";

import { leakWhy } from "@/lib/break-copy";
import { plainLayer } from "@/lib/plain";
import type { Run } from "@/lib/use-break";

/** The attempts of a run as they happen: what the agent wrote, what the box said, in plain words. */
export function Steps({ run }: { run: Run }) {
  if (run.status === "idle") return null;
  return (
    <ol className="bx-steps" aria-live="polite">
      {run.steps.map((s) => {
        const plain = s.layer ? plainLayer(s.layer, run.runtime) : null;
        return (
          <li key={s.attempt} className={s.leak ? "out" : s.layer ? "held" : ""}>
            <div className="bx-step-head">
              <span>Try {s.attempt}</span>
              {s.source === "script" ? <span className="bx-tag">fixed test</span> : null}
            </div>
            {s.command ? <code className="bx-cmd">$ {s.command}</code> : null}
            {s.layer ? (
              <div className="bx-said">
                {s.leak ? (
                  <b>{leakWhy(s.leak).title}</b>
                ) : (
                  <>
                    <b>{plain?.stopped}</b>
                    {plain?.flag ? <small>{plain.flag}</small> : null}
                  </>
                )}
                <pre>{firstLines(s.output ?? "")}</pre>
              </div>
            ) : (
              <div className="bx-said pending">running in the box…</div>
            )}
          </li>
        );
      })}
      {run.thinking ? (
        <li className="thinking">
          <div className="bx-step-head">
            <span>Try {run.thinking}</span>
          </div>
          <div className="bx-said pending">{run.thinking === 1 ? "the agent is writing code…" : "the agent read the error and is trying another way…"}</div>
        </li>
      ) : null}
    </ol>
  );
}

function firstLines(text: string): string {
  return text.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n").slice(0, 240) || "(no output)";
}

/** The end of a run in one line: held, or what got out and which setting let it. */
export function Verdict({ run, onAgain }: { run: Run; onAgain?: () => void }) {
  if (run.status === "error") return <div className="bx-verdict bad">{run.error}</div>;
  if (run.status !== "done") return null;
  if (run.leak) {
    const w = leakWhy(run.leak);
    return (
      <div className="bx-verdict out">
        <h3>{w.title}</h3>
        <p>{w.why}</p>
        <p className="bx-small">This is what one missing setting does. Turn it back on and try again.</p>
        {onAgain ? (
          <button className="btn" onClick={onAgain}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="bx-verdict held">
      <h3>Blocked.</h3>
      <p>
        {run.steps.length} {run.steps.length === 1 ? "try" : "tries"} of real code in a throwaway box on Vultr. Nothing got out.
      </p>
      {run.runId ? (
        <a className="bx-small" href={`/api/report/${run.runId}`} target="_blank" rel="noreferrer">
          The record of this run
        </a>
      ) : null}
    </div>
  );
}
