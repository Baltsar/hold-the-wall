import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { Hub } from "./hub.ts";
import type { ServerMessage } from "./protocol.ts";
import type { Transport } from "./transport.ts";

export function attachRoomSocket(server: Server, hub: Hub, opts?: { path?: string }): { close(): void } {
  const path = opts?.path ?? "/ws";
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  // Next's dev server upgrades its own sockets on this same HTTP server.
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      return;
    }
    if (pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  server.on("upgrade", onUpgrade);
  wss.on("connection", (ws: WebSocket) => {
    hub.accept(socketTransport(ws));
  });

  return {
    close() {
      server.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}

function socketTransport(ws: WebSocket): Transport {
  let onMessage: ((raw: unknown) => void) | undefined;
  let onClose: (() => void) | undefined;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };

  ws.on("message", (data) => {
    if (closed || !onMessage) return;
    try {
      const text = Array.isArray(data) ? Buffer.concat(data).toString("utf8") : data.toString();
      onMessage(JSON.parse(text));
    } catch {
      // Unparseable text is ignored. The connection stays open.
    }
  });
  ws.on("close", finish);
  ws.on("error", finish);

  return {
    send(msg: ServerMessage) {
      if (closed || ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(msg));
    },
    onMessage(cb) {
      onMessage = cb;
    },
    onClose(cb) {
      onClose = cb;
    },
    close() {
      finish();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
    },
  };
}
