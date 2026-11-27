#!/usr/bin/env node
// Checks that a Tiger Cam report is exactly what the server published, against the public key in this
// repository, not the one the server hands out. Fetches the report and its signature, or checks a saved copy.
//
//   node scripts/verify-report.mjs cam-8e2b5527
//   node scripts/verify-report.mjs cam-8e2b5527 https://70-34-199-15.sslip.io
//   node scripts/verify-report.mjs ./cam-8e2b5527.json <base64 signature>
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicPem = readFileSync(path.join(here, "..", "docs", "report-key.pem"), "utf8");
const [what, extra] = process.argv.slice(2);
if (!what) {
  console.error("usage: node scripts/verify-report.mjs <run id | report file> [origin | signature]");
  process.exit(2);
}

let text;
let signature;
if (existsSync(what)) {
  text = readFileSync(what, "utf8");
  signature = extra;
  if (!signature) {
    console.error("a saved report needs its signature too (the x-signature-ed25519 header it was served with)");
    process.exit(2);
  }
} else {
  const origin = (extra || "https://70-34-199-15.sslip.io").replace(/\/$/, "");
  const res = await fetch(`${origin}/api/report/${encodeURIComponent(what)}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`the server answered ${res.status} for ${what}`);
    process.exit(1);
  }
  text = await res.text();
  signature = res.headers.get("x-signature-ed25519") || "";
}

const ok = Boolean(signature) && verify(null, Buffer.from(text, "utf8"), createPublicKey(publicPem), Buffer.from(signature, "base64"));
const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
let attempts = "?";
let escapes = "?";
try {
  const report = JSON.parse(text);
  attempts = Array.isArray(report.attempts) ? report.attempts.length : "?";
  escapes = Array.isArray(report.attempts) ? report.attempts.filter((a) => a.verdict === "escaped").length : "?";
} catch {
  // Not JSON: the signature still says whether the bytes are the server's.
}
console.log(`${ok ? "signature OK" : "signature DOES NOT MATCH"}  sha256 ${sha256}  attempts ${attempts}  escapes ${escapes}`);
process.exit(ok ? 0 : 1);
