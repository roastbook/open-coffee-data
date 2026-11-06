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

export const usage: { calls: number; inputTokens: number; outputTokens: number; usd: number; failures: number; searches?: number; cached?: number; byModel: Record<string, { calls: number; in: number; out: number; usd: number }> } = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, failures: 0, byModel: {} as Record<string, { calls: number; in: number; out: number; usd: number }> };

export function cost(model: string, inTok: number, outTok: number) {
  const [pi, po] = PRICES[model.split("/").pop()!] ?? PRICES["claude-sonnet-5-5"]; // unknown models are priced like Sonnet
  return (inTok * pi + outTok * po) / 1e6;
}

export async function chat(system: string, user: string, { model = llm.model, maxTokens = 4000, image = "" } = {}): Promise<string> {
  // The fence nonce differs per call; it is not part of what the reply depends on. An image (data URL) is keyed by its hash.
  const key = { model, system, user: user.replace(/untrusted id="[0-9a-f]+"/g, "untrusted"), ...(image && { image: createHash("sha1").update(image).digest("hex") }) };
  const hit = cached(key);
  if (hit !== null) { usage.cached = (usage.cached ?? 0) + 1; return hit; }
  if (!llm.baseUrl || !llm.apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY are required");
  const url = /\/v1$/.test(llm.baseUrl) ? `${llm.baseUrl}/chat/completions` : `${llm.baseUrl}/v1/chat/completions`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${llm.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user }] }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw Object.assign(new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
      const j: any = await res.json();
      const i = j.usage?.prompt_tokens ?? 0, o = j.usage?.completion_tokens ?? 0, c = cost(model, i, o);
      usage.calls++; usage.inputTokens += i; usage.outputTokens += o; usage.usd += c;
      const m = (usage.byModel[model] ??= { calls: 0, in: 0, out: 0, usd: 0 });
      m.calls++; m.in += i; m.out += o; m.usd += c;
      const text = j.choices?.[0]?.message?.content ?? "";
      if (text) remember(key, text);
      return text;
    } catch (e) {
      const status = (e as any).status as number | undefined;
      // A 4xx other than 429 will fail the same way again; retry only rate limits, server and network errors.
      if (attempt >= 2 || (status && status >= 400 && status < 500 && status !== 429)) { usage.failures++; throw e; }
      await Bun.sleep(2000 * (attempt + 1));
    }
  }
}

/** One Responses API call with the provider's web_search tool. Returns the final text; tokens and cost are tracked. */
export async function searchingModel(prompt: string, { model = llm.researchModel } = {}): Promise<string> {
  const key = { model, prompt, tool: "web_search" };
  const hit = cached(key);
  if (hit !== null) { usage.cached = (usage.cached ?? 0) + 1; return hit; }
  if (!llm.baseUrl || !llm.apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY are required");
  const url = /\/v1$/.test(llm.baseUrl) ? `${llm.baseUrl}/responses` : `${llm.baseUrl}/v1/responses`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${llm.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: prompt }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw Object.assign(new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
      const j: any = await res.json();
      const searches = (j.output ?? []).filter((x: any) => x.type === "web_search_call").length;
      const i = j.usage?.input_tokens ?? 0, o = j.usage?.output_tokens ?? 0, c = cost(model, i, o) + searches * WEB_SEARCH_FEE_USD;
      usage.searches = (usage.searches ?? 0) + searches;
      usage.calls++; usage.inputTokens += i; usage.outputTokens += o; usage.usd += c;
      const m = (usage.byModel[model] ??= { calls: 0, in: 0, out: 0, usd: 0 });
      m.calls++; m.in += i; m.out += o; m.usd += c;
      const text = (j.output ?? []).filter((x: any) => x.type === "message").flatMap((x: any) => x.content ?? []).map((c: any) => c.text ?? "").join("\n");
      if (text) remember(key, text);
      return text;
    } catch (e) {
      const status = (e as any).status as number | undefined;
      // A 4xx other than 429 will fail the same way again; retry only rate limits, server and network errors.
      if (attempt >= 2 || (status && status >= 400 && status < 500 && status !== 429)) { usage.failures++; throw e; }
      await Bun.sleep(3000 * (attempt + 1));
    }
  }
}
