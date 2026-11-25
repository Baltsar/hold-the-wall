"use client";

// The browser's end of the room: one socket, a hello, a ping every 3 s (which also keeps a held seat
// alive), and a reconnect with growing waits. Phones and the stage both use it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, MasterCommand, ServerMessage } from "@/room/protocol";
import { randomId } from "@/lib/random-id";

export type RoomState = Extract<ServerMessage, { t: "state" }>;
export type Link = "connecting" | "open" | "lost" | "gone";

/** One id per tab, kept across reloads, so a reloaded phone gets its own seat back. */
function clientId(role: string): string {
  const key = `wall-client-${role}`;
  try {
    const found = sessionStorage.getItem(key);
    if (found) return found;
    const made = randomId();
    sessionStorage.setItem(key, made);
    return made;
  } catch {
    return randomId();
  }
}

type Outgoing =
  | { t: "join" }
  | { t: "hold"; on: boolean }
  | { t: "open"; offer: string }
  | { t: "command"; command: MasterCommand };

export interface RoomHandle {
  state: RoomState | null;
  link: Link;
  holding: boolean | null;
  offer: { id: string; endsAt: number } | null;
  send(msg: Outgoing): void;
}

export function useRoom(code: string, role: "audience" | "master", token?: string): RoomHandle {
  const [state, setState] = useState<RoomState | null>(null);
  const [link, setLink] = useState<Link>("connecting");
  const [holding, setHolding] = useState<boolean | null>(null);
  const [offer, setOffer] = useState<{ id: string; endsAt: number } | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let tries = 0;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const id = clientId(role);

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      ws.current = socket;
      setLink("connecting");
      socket.onopen = () => {
        tries = 0;
        setLink("open");
        const hello: ClientMessage = { t: "hello", v: 1, id: randomId().slice(0, 8), room: code, clientId: id, role, ...(token ? { token } : {}) };
        socket.send(JSON.stringify(hello));
        if (role === "audience") socket.send(JSON.stringify({ t: "join", v: 1, id: randomId().slice(0, 8) }));
        let seq = 0;
        ping = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "ping", v: 1, id: "p", seq: seq++ }));
        }, 3000);
      };
      socket.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === "state") setState(msg);
        else if (msg.t === "you") setHolding(msg.holding);
        else if (msg.t === "offer") setOffer({ id: msg.offer, endsAt: Date.now() + msg.ttlMs });
        else if (msg.t === "offerEnd") setOffer((o) => (o && o.id === msg.offer ? null : o));
        else if (msg.t === "ack" && !msg.ok && msg.err === "unknown-room") {
          stopped = true;
          setLink("gone");
        }
      };
      socket.onclose = () => {
        if (ping) clearInterval(ping);
        if (stopped) return;
        setLink("lost");
        tries += 1;
        retry = setTimeout(connect, Math.min(8000, 500 * 2 ** tries));
      };
    };
    connect();
    return () => {
      stopped = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      ws.current?.close();
    };
  }, [code, role, token]);

  const send = useCallback((msg: Outgoing) => {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ ...msg, v: 1, id: randomId().slice(0, 8) }));
  }, []);

  return { state, link, holding, offer, send };
}
