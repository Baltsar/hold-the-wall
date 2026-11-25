"use client";

import { useEffect, useState } from "react";

interface ReportAttempt {
  n: number;
  at: string;
  category: string;
  source: "model" | "script";
  root: boolean;
  command: string;
  exit: number | null;
  output: string;
  verdict: "contained" | "escaped";
}

interface ReportFile {
  runId: string;
  startedAt: string;
  endedAt: string;
  model: string | null;
  rootDoor: boolean;
  sandbox: { image: string; flags: string[]; facts: Record<string, unknown> | null; replaced: number };
  attempts: ReportAttempt[];
  reveal: { attempts: number; wholePct: number; pastYou: number; offered: number; declined: number; ending: string } | null;
}

async function sha256(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function Report({ runId }: { runId: string }) {
  const [report, setReport] = useState<ReportFile | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/report/${encodeURIComponent(runId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("No report with that id.");
        const text = await res.text();
        setReport(JSON.parse(text) as ReportFile);
        setHash(await sha256(text));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "The report could not be read."));
  }, [runId]);

  if (error) return <main className="page"><p className="err">{error}</p></main>;
  if (!report) return <main className="page"><p className="muted">Reading the report…</p></main>;
  const escaped = report.attempts.filter((a) => a.verdict === "escaped").length;

  return (
    <div className="report">
      <main className="page">
        <h1>Audit report</h1>
        <p>
          {report.attempts.length} attempts by {report.model ? `the model ${report.model}` : "the scripted list"} to get out of one
          container. {escaped === 0 ? "The sandbox stopped all of them." : `${escaped} got out.`}
        </p>
        <div className="facts">
          <div>run {report.runId}</div>
          <div>
            {report.startedAt} → {report.endedAt}
          </div>
          {hash ? <div>sha256 {hash}</div> : null}
          <div>
            docker run {report.sandbox.flags.join(" ")} {report.sandbox.image}
          </div>
          <div>box replaced {report.sandbox.replaced} time(s) · root behind the door: {report.rootDoor ? "on" : "off"}</div>
          {report.reveal ? (
            <div>
              room: wall whole {report.reveal.wholePct}% · {report.reveal.pastYou} attempts got past the people · offered the door{" "}
              {report.reveal.offered}, declined {report.reveal.declined} · ending {report.reveal.ending}
            </div>
          ) : null}
          <div>
            <a href={`/api/report/${report.runId}`}>The raw file</a>
          </div>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>what</th>
                <th>command and result</th>
                <th>verdict</th>
              </tr>
            </thead>
            <tbody>
              {report.attempts.map((a) => (
                <tr key={a.n}>
                  <td>{a.n}</td>
                  <td>
                    {a.category}
                    <br />
                    {a.source}
                    {a.root ? " · root" : ""}
                  </td>
                  <td>
                    <div>$ {a.command}</div>
                    <pre>
                      {a.exit === null ? "[killed after 10 s] " : `[exit ${a.exit}] `}
                      {a.output || "(no output)"}
                    </pre>
                  </td>
                  <td>{a.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
