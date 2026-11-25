/**
 * A random id in the form of crypto.randomUUID(), for the pages in the browser. randomUUID exists only in
 * a secure context (https or localhost), and the phones reach the laptop at its network address over
 * plain http, where it is missing. getRandomValues is there in every context, so the id is made from it.
 */
export function randomId(source: Pick<Crypto, "getRandomValues"> = crypto): string {
  const bytes = source.getRandomValues(new Uint8Array(16));
  // Version 4 and the RFC 4122 variant, as randomUUID sets them.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
