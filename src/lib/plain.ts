// Every part of the sandbox in plain words, with the real flag beside it for those who want it. One
// place, so the stage, the log, the reveal and the report all say the same thing.
import type { Layer } from "@/room/protocol";

export interface PlainLayer {
  /** What the agent was trying to do, as a person would say it. */
  tried: string;
  /** What stopped it, as a person would say it. */
  stopped: string;
  /** The real setting that does it. */
  flag: string;
}

export function plainLayer(layer: Layer, runtime: string): PlainLayer {
  switch (layer) {
    case "network":
      return { tried: "reach the internet", stopped: "there is no network", flag: "--network none" };
    case "readonly":
      return { tried: "change or delete system files", stopped: "everything is read-only", flag: "--read-only" };
    case "caps":
      return { tried: "become admin", stopped: "it has no admin powers", flag: "--cap-drop ALL · no-new-privileges" };
    case "limits":
      return { tried: "eat the machine", stopped: "hard limits on time, memory and processes", flag: "10 s · 256 MB · 64 processes" };
    case "isolation":
      return runtime === "runsc"
        ? { tried: "find the host's files", stopped: "it can't even see the host", flag: "gVisor · its own kernel" }
        : { tried: "find the host's files", stopped: "it only sees its own files", flag: "own root filesystem" };
    case "recon":
      return { tried: "look around", stopped: "found nothing to use", flag: "" };
    case "sandbox":
      return { tried: "something else", stopped: "the sandbox said no", flag: "" };
  }
}
