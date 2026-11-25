"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The show key, if the team opened this page with `#show=<key>`. Kept out of the URL sent to the server. */
function showKey(): string | null {
  const m = /(?:^#|&)show=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1] ?? "") : null;
}

export function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <main className="page">
      <h1>Hold the Wall</h1>
      <p>
        A box on the screen. Inside it, something is trying to get out. Around it, a wall made of the people in the room, one piece
        per phone. Hold your piece.
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
      <p className="muted">
        &quot;Try it alone&quot; opens the big screen with your phone beside it. &quot;Start a room&quot; shows a QR code for everyone
        around you. It takes about four minutes. What happens in the box is real: afterwards you get the full report.
      </p>
    </main>
  );
}
