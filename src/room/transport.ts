import type { ServerMessage } from "./protocol.ts";

export interface Transport {
  send(msg: ServerMessage): void;
  onMessage(cb: (raw: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface MockClient {
  send(msg: unknown): void;
  received: ServerMessage[];
  close(): void;
  closed: boolean;
}

export function createMockPair(): { server: Transport; client: MockClient } {
  let onMessage: ((raw: unknown) => void) | undefined;
  let onClose: (() => void) | undefined;
  let closed = false;
  const received: ServerMessage[] = [];

  const finish = () => {
    if (closed) return;
    closed = true;
    client.closed = true;
    onClose?.();
  };

  const client: MockClient = {
    received,
    closed: false,
    send(msg: unknown) {
      if (closed) return;
      onMessage?.(msg);
    },
    close: finish,
  };

  const server: Transport = {
    send(msg: ServerMessage) {
      if (closed) return;
      received.push(msg);
    },
    onMessage(cb) {
      onMessage = cb;
    },
    onClose(cb) {
      onClose = cb;
    },
    close: finish,
  };

  return { server, client };
}
