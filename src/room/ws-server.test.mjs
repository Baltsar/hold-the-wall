// The room socket accepts this site's own pages and clients that are not browsers, and refuses a socket
// another site's page opens in a visitor's browser.
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { attachRoomSocket } from "./ws-server.ts";

function open(port, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    ws.on("error", () => resolve("error"));
  });
}

test("the room socket refuses other sites and lets this site in", async () => {
  const server = createServer();
  const accepted = [];
  const socket = attachRoomSocket(server, { accept: (t) => accepted.push(t) }, { path: "/ws" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    assert.equal(await open(port, `http://127.0.0.1:${port}`), "open");
    assert.equal(await open(port, undefined), "open");
    assert.equal(await open(port, "https://evil.example"), 403);
    assert.equal(await open(port, `http://127.0.0.1:${port + 1}`), 403);
    assert.equal(await open(port, "null"), 403);
    assert.equal(accepted.length, 2);
  } finally {
    socket.close();
    await new Promise((r) => server.close(r));
  }
});
