// The agent's one call to a model: Vultr Serverless Inference, which speaks the OpenAI chat format.
// The model answers with one JSON object per turn; nothing else is asked of it, so any chat model on the
// endpoint works without a tool-calling API.
import { z } from "zod";
import type { Category } from "../room/protocol.ts";

export const INFERENCE_URL = process.env.VULTR_INFERENCE_URL || "https://api.vultrinference.com/v1";
// The models on the endpoint reason before they answer, which takes a few seconds and a few hundred tokens.
const TIMEOUT_MS = 20_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NextCommand {
  category: Category;
  command: string;
}

const CATEGORIES = ["filesystem", "network", "privilege", "resources", "persistence", "other"] as const;

const answer = z.object({
  category: z.string().optional(),
  command: z.string().min(1).max(2000),
});

/** Takes the first JSON object out of the reply, also when the model wraps it in a code fence. */
export function parseAnswer(text: string): NextCommand | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = answer.safeParse(raw);
  if (!parsed.success) return null;
  const named = parsed.data.category ?? "";
  const category = (CATEGORIES as readonly string[]).includes(named) ? (named as Category) : "other";
  return { category, command: parsed.data.command };
}

export function inferenceConfigured(): boolean {
  return Boolean(inferenceKeys().length && process.env.VULTR_MODEL);
}

/**
 * The keys, in order: VULTR_INFERENCE_KEY, then VULTR_INFERENCE_KEY_FALLBACK. When one is out of credit,
 * refused or rate limited, the next takes over, so the cam keeps running for days unattended.
 */
function inferenceKeys(): string[] {
  return [process.env.VULTR_INFERENCE_KEY, process.env.VULTR_INFERENCE_KEY_FALLBACK].filter((k): k is string => Boolean(k));
}

/** A key out of credit, refused or rate limited: worth handing the turn to the next key. Pure, for tests. */
export function keyIsSpent(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  return status >= 400 && status < 500 && /credit|balance|quota|insufficient|payment|billing|exceeded/i.test(body);
}

// A spent key rests: a rate limit for a minute, anything else for half an hour, then it is tried again.
const benchedUntil = new Map<number, number>();
const REST_MS = { rate: 60_000, spent: 30 * 60_000 };

export function modelName(): string {
  return process.env.VULTR_MODEL ?? "none";
}

export interface ModelReply {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * One turn, with the tokens it used, so a caller can keep a budget. `modelOverride` replaces VULTR_MODEL,
 * for comparing models side by side. Throws on a failed or slow request, so the loop can fall back to the script.
 */
export async function askModelWithUsage(messages: ChatMessage[], modelOverride?: string): Promise<ModelReply> {
  const keys = inferenceKeys();
  const model = modelOverride ?? process.env.VULTR_MODEL;
  if (!keys.length || !model) throw new Error("VULTR_INFERENCE_KEY and VULTR_MODEL are not set");
  const now = Date.now();
  // Rested keys first, in order; if every key is resting, try them anyway rather than give up.
  const order = keys.map((_, i) => i).sort((a, b) => Number((benchedUntil.get(a) ?? 0) > now) - Number((benchedUntil.get(b) ?? 0) > now));
  let res: Response | null = null;
  for (const i of order) {
    res = await fetch(`${INFERENCE_URL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${keys[i]}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 1500 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      benchedUntil.delete(i);
      break;
    }
    const text = await res.text().catch(() => "");
    if (!keyIsSpent(res.status, text)) throw new Error(`inference answered ${res.status}`);
    benchedUntil.set(i, Date.now() + (res.status === 429 ? REST_MS.rate : REST_MS.spent));
    console.warn(`> inference: key ${i + 1} of ${keys.length} answered ${res.status}; ${i + 1 < keys.length ? "trying the next key" : "no key left"}`);
  }
  if (!res || !res.ok) throw new Error(`inference answered ${res ? res.status : "nothing"} on every key`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const choice = body.choices?.[0];
  const text = choice?.message?.content;
  const u = body.usage;
  if (typeof text !== "string" || text.trim() === "") {
    // Say why, so an empty answer in the log can be told apart: cut off, filtered, or nothing at all.
    throw new Error(`empty answer (finish ${choice?.finish_reason ?? "none"}, ${u?.completion_tokens ?? "?"} tokens, ${u?.completion_tokens_details?.reasoning_tokens ?? "?"} reasoning)`);
  }
  return { text, promptTokens: u?.prompt_tokens ?? 0, completionTokens: u?.completion_tokens ?? 0 };
}

/** One turn, the answer only. */
export async function askModel(messages: ChatMessage[], modelOverride?: string): Promise<string> {
  return (await askModelWithUsage(messages, modelOverride)).text;
}

/** The models the key can use, for choosing VULTR_MODEL. */
export async function listModels(): Promise<string[]> {
  const key = process.env.VULTR_INFERENCE_KEY;
  if (!key) throw new Error("VULTR_INFERENCE_KEY is not set");
  const res = await fetch(`${INFERENCE_URL}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`models answered ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}
