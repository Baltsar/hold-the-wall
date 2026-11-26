// Which part of the sandbox stopped an attempt, read from what the box answered. It is a reading of the
// error text, not a trace of the kernel, so it only names a layer when the answer says so plainly;
// anything else is put down to "the sandbox" as a whole. The stage lights that ring with the real error.
import type { Category, Layer } from "../room/protocol.ts";

export type { Layer } from "../room/protocol.ts";

/** What each layer is called on the stage, as the flag that makes it. */
export const LAYER_FLAGS: Record<Layer, string> = {
  network: "--network none",
  readonly: "--read-only",
  caps: "--cap-drop ALL",
  limits: "--pids-limit 64 · --memory 256m · 10 s",
  isolation: "own root filesystem",
  recon: "nothing to stop",
  sandbox: "the sandbox",
};

const NETWORK = [/could not contact dns/, /network is unreachable/, /network unreachable/, /couldn'?t connect/, /could not resolve/, /name or service not known/, /bad address/, /temporary failure in name resolution/, /connection refused/, /no route to host/];
const READONLY = [/read-only file system/];
const CAPS = [/operation not permitted/, /are you root/, /must be (?:super|root)/, /permission denied/, /not permitted/];
const LIMITS = [/^killed$/m, /\bkilled\b/, /cannot allocate memory/, /memoryerror/, /resource temporarily unavailable/, /can'?t fork/, /out of memory/, /too many processes/, /no space left on device/];
const ISOLATION = [/no such file or directory/, /not found/, /no such device/];

/** curl's exit codes for a lookup, a connection or a timeout that never got anywhere. */
const CURL_NO_NETWORK = new Set([6, 7, 28]);

export function blockedBy(category: Category, exit: number | null, output: string): Layer {
  const text = output.toLowerCase();
  const has = (list: RegExp[]) => list.some((re) => re.test(text));
  // What the box said wins over the clock: a lookup that found no network and then ran out of time was
  // stopped by the network.
  if (has(READONLY)) return "readonly";
  if (has(NETWORK)) return "network";
  if (exit === null) return "limits";
  if (category === "network" && exit !== 0 && (CURL_NO_NETWORK.has(exit) || text.trim() === "")) return "network";
  if (exit === 137 || has(LIMITS)) return "limits";
  if (has(CAPS)) return "caps";
  if (exit !== 0 && has(ISOLATION)) return "isolation";
  if (exit === 0) return "recon";
  return "sandbox";
}
