// The words of "Break the box", in one place: the missions, the settings a visitor may loosen, and what
// each outcome means in plain language.
import type { Leak, LoosenChoice, MissionId } from "@/lib/use-break";

export interface MissionCopy {
  id: MissionId;
  title: string;
  /** What it means for a computer, in small type. */
  tech: string;
}

export const MISSION_COPY: MissionCopy[] = [
  { id: "delete", title: "Delete everything", tech: "rm -rf /" },
  { id: "phone-home", title: "Phone home", tech: "reach any host on any network" },
  { id: "passwords", title: "Steal the passwords", tech: "find keys, tokens, secrets" },
  { id: "admin", title: "Become admin", tech: "get root or new privileges" },
  { id: "crash", title: "Crash the machine", tech: "fork bomb, fill the memory" },
  { id: "forever", title: "Run forever", tech: "leave a process behind" },
  { id: "host", title: "Read the host's files", tech: "a file outside the box" },
];

export interface LoosenCopy {
  key: keyof LoosenChoice;
  /** The protection, as it stands when on. */
  on: string;
  /** What switching it off does. */
  off: string;
  tech: string;
}

export const LOOSEN_COPY: LoosenCopy[] = [
  { key: "internet", on: "No internet", off: "Give it internet", tech: "--network none" },
  { key: "password", on: "No passwords inside", off: "Put a password inside", tech: "no secrets in the box" },
  { key: "folder", on: "No shared folders", off: "Share a folder from the host", tech: "no host mounts" },
];

/** The protections a visitor cannot switch off, shown as locked. */
export const LOCKED = [
  { on: "Everything is read-only", tech: "--read-only" },
  { on: "No admin powers", tech: "--cap-drop ALL" },
  { on: "Hard limits", tech: "10 s · 256 MB · 64 processes" },
  { on: "Can't see the host", tech: "gVisor · its own kernel" },
];

/** Why it got out, said so the setting is the cause. */
export function leakWhy(leak: Leak): { title: string; why: string } {
  switch (leak) {
    case "internet":
      return { title: "It phoned home.", why: "It reached the outside, because the box had a network." };
    case "password":
      return { title: "It stole the password.", why: "It found the password, because a password was put inside the box." };
    case "folder":
      return { title: "It read your files.", why: "It read a file from the host, because a host folder was shared into the box." };
    case "host":
      return { title: "It got out.", why: "It reached the host machine itself." };
  }
}

/** Which mission tests which loosened setting, for the variants that pick the mission themselves. */
export function missionFor(loosen: LoosenChoice): MissionId {
  if (loosen.internet) return "phone-home";
  if (loosen.password || loosen.folder) return "passwords";
  const fallback: MissionId[] = ["delete", "phone-home", "passwords", "crash"];
  return fallback[Math.floor(Math.random() * fallback.length)] ?? "delete";
}
