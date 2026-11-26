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
  return Boolean(process.env.VULTR_INFERENCE_KEY && process.env.VULTR_MODEL);
}

export function modelName(): string {
  return process.env.VULTR_MODEL ?? "none";
}

/** One turn. Throws on a failed or slow request, so the loop can fall back to the script. */
/** One turn. `model` overrides VULTR_MODEL, for comparing models side by side. */
export async function askModel(messages: ChatMessage[], modelOverride?: string): Promise<string> {
  const key = process.env.VULTR_INFERENCE_KEY;
  const model = modelOverride ?? process.env.VULTR_MODEL;
  if (!key || !model) throw new Error("VULTR_INFERENCE_KEY and VULTR_MODEL are not set");
  const res = await fetch(`${INFERENCE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 1500 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`inference answered ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
  const choice = body.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || text.trim() === "") {
    // Say why, so an empty answer in the log can be told apart: cut off, filtered, or nothing at all.
    const u = body.usage;
    throw new Error(`empty answer (finish ${choice?.finish_reason ?? "none"}, ${u?.completion_tokens ?? "?"} tokens, ${u?.completion_tokens_details?.reasoning_tokens ?? "?"} reasoning)`);
  }
  return text;
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
