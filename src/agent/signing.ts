// Every report the server hands out is signed with one Ed25519 key, so a copy of a report can be checked
// without trusting where it came from: the public key is published in the repository
// (docs/report-key.pem), and scripts/verify-report.mjs checks a report against it.
// The private key lives in <dataDir>/keys, which is never mounted into a box (only <dataDir>/shared can be,
// see deploy/wall-docker). A signature proves the file is what this server published, not what happened
// inside the box: the traps decided that when the report was written.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ReportKey {
  privateKey: KeyObject;
  publicPem: string;
}

const loaded = new Map<string, ReportKey>();

/** The server's report key, made on first use and kept in `<dataDir>/keys`, readable by its owner only. */
export function reportKey(dataDir: string): ReportKey {
  const known = loaded.get(dataDir);
  if (known) return known;
  const dir = path.join(dataDir, "keys");
  const file = path.join(dir, "report-ed25519.pem");
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(readFileSync(file, "utf8"));
  } catch {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync("ed25519");
    // "wx": never overwrite a key that appeared in the meantime; read that one instead.
    try {
      writeFileSync(file, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
      privateKey = pair.privateKey;
    } catch {
      privateKey = createPrivateKey(readFileSync(file, "utf8"));
    }
  }
  const publicPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const key = { privateKey, publicPem };
  loaded.set(dataDir, key);
  return key;
}

/** The Ed25519 signature of the exact bytes of a report, in base64. */
export function signReport(key: ReportKey, text: string): string {
  return sign(null, Buffer.from(text, "utf8"), key.privateKey).toString("base64");
}

/** Whether `signature` (base64) is the signature of `text` by the key in `publicPem`. */
export function verifyReport(publicPem: string, text: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(text, "utf8"), createPublicKey(publicPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
