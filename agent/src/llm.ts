import { modelReply } from "./network-payloads";
// OpenAI-compatible chat client with token and estimated-cost accounting (reported in the run metrics).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, llm, PRICES, WEB_SEARCH_FEE_USD } from "./config";

// Replies are cached by exact request for 30 days (like fetched pages), so a rerun over unchanged pages costs nothing.
// The cache is in .cache/llm and is never committed.
const LLM_TTL_MS = 30 * 24 * 3600 * 1000;
const cacheFile = (req: unknown) => join(CACHE, "llm", createHash("sha1").update(JSON.stringify(req)).digest("hex") + ".json");
function cached(req: unknown): string | null {
  const f = cacheFile(req);
  if (!existsSync(f)) return null;
  const c = JSON.parse(readFileSync(f, "utf8"));
  return Date.now() - c.at < LLM_TTL_MS ? c.text : null;
}
function remember(req: unknown, text: string) {
  mkdirSync(join(CACHE, "llm"), { recursive: true });
  writeFileSync(cacheFile(req), JSON.stringify({ at: Date.now(), text }));
}

export const usage: { calls: number; inputTokens: number; outputTokens: number; usd: number; failures: number; searches?: number; cached?: number; byModel: Record<string, { calls: number; in: number; out: number; usd: number }> } = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, failures: 0, byModel: {} };

export function cost(model: string, inTok: number, outTok: number) {
  const [pi, po] = Object.hasOwn(PRICES, model.split("/").at(-1) ?? "") ? PRICES[model.split("/").at(-1) ?? ""] : PRICES["claude-sonnet-5-5"]; // unknown models are priced like Sonnet
  return (inTok * pi + outTok * po) / 1e6;
}

export async function chat(system: string, user: string, { model = llm.model, maxTokens = 4000, image = "" } = {}): Promise<string> {
  const key = chatCacheKey(model, system, user, image);
  const hit = cached(key);
  if (hit !== null) { usage.cached = (usage.cached ?? 0) + 1; return hit; }
  requireModelConfig();
  const reply = await withRetry(() => requestModel("chat/completions", {
    model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: userContent(user, image) }],
  }, 180_000), 2000);
  const text = chatResult(model, reply);
  if (text) remember(key, text);
  return text;
}

function chatCacheKey(model: string, system: string, user: string, image: string) {
  // Fence nonces are not part of what the reply depends on. Images are keyed by hash.
  return { model, system, user: user.replace(/untrusted id="[0-9a-f]+"/g, "untrusted"), ...(image && { image: createHash("sha1").update(image).digest("hex") }) };
}

function userContent(user: string, image: string) {
  return image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user;
}

function chatResult(model: string, reply: ReturnType<typeof modelReply>): string {
  const i = reply.usage?.prompt_tokens ?? 0, o = reply.usage?.completion_tokens ?? 0;
  accountUsage(model, i, o, cost(model, i, o));
  return reply.choices?.[0]?.message?.content ?? "";
}

/** One Responses API call with the provider's web_search tool. Returns the final text; tokens and cost are tracked. */
export async function searchingModel(prompt: string, { model = llm.researchModel } = {}): Promise<string> {
  const key = { model, prompt, tool: "web_search" };
  const hit = cached(key);
  if (hit !== null) { usage.cached = (usage.cached ?? 0) + 1; return hit; }
  requireModelConfig();
  const reply = await withRetry(() => requestModel("responses", { model, tools: [{ type: "web_search" }], input: prompt }, 300_000), 3000);
  const text = searchResult(model, reply);
  if (text) remember(key, text);
  return text;
}

function searchResult(model: string, reply: ReturnType<typeof modelReply>): string {
  const output = reply.output ?? [];
  const searches = output.filter((x) => x.type === "web_search_call").length;
  const i = reply.usage?.input_tokens ?? 0, o = reply.usage?.output_tokens ?? 0;
  usage.searches = (usage.searches ?? 0) + searches;
  accountUsage(model, i, o, cost(model, i, o) + searches * WEB_SEARCH_FEE_USD);
  return output.filter((x) => x.type === "message").flatMap((x) => x.content ?? []).map((c) => c.text ?? "").join("\n");
}

async function requestModel(path: string, body: object, timeout: number): Promise<ReturnType<typeof modelReply>> {
  const base = llm.baseUrl.endsWith("/v1") ? llm.baseUrl : `${llm.baseUrl}/v1`;
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${llm.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw Object.assign(new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return modelReply(await res.json());
}

async function withRetry<T>(operation: () => Promise<T>, delay: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (e) {
      if (!retryable(e, attempt)) { usage.failures++; throw e; }
      await Bun.sleep(delay * (attempt + 1));
    }
  }
}

function accountUsage(model: string, i: number, o: number, c: number) {
  usage.calls++; usage.inputTokens += i; usage.outputTokens += o; usage.usd += c;
  const m = Object.hasOwn(usage.byModel, model) ? usage.byModel[model] : { calls: 0, in: 0, out: 0, usd: 0 };
  Object.defineProperty(usage.byModel, model, { value: m, enumerable: true, configurable: true, writable: true });
  m.calls++; m.in += i; m.out += o; m.usd += c;
}

function retryable(error: unknown, attempt: number): boolean {
  const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : undefined;
  return attempt < 2 && !(status && status >= 400 && status < 500 && status !== 429);
}

function requireModelConfig(): void {
  if (!llm.baseUrl || !llm.apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY are required");
}
