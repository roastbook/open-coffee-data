// OpenAI-compatible chat client with token and cost accounting and a monthly hard stop.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { budget, CACHE, llm, PRICES } from "./config";

export const usage = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, failures: 0, byModel: {} as Record<string, { calls: number; in: number; out: number; usd: number }> };

const ledgerFile = join(process.env.SOURCING_STATE_DIR ?? join(CACHE, "state"), "budget.json");
const month = () => new Date().toISOString().slice(0, 7);
function ledger(): Record<string, number> { return existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {}; }
function addToLedger(usd: number) {
  const l = ledger(); l[month()] = (l[month()] ?? 0) + usd;
  mkdirSync(join(ledgerFile, ".."), { recursive: true });
  writeFileSync(ledgerFile, JSON.stringify(l, null, 1));
}
export const monthSpent = () => ledger()[month()] ?? 0;

export class BudgetExceeded extends Error {}
export function checkBudget() {
  if (monthSpent() >= budget.monthlyUsd) throw new BudgetExceeded(`monthly budget $${budget.monthlyUsd} spent ($${monthSpent().toFixed(2)})`);
  if (usage.usd >= budget.runUsd) throw new BudgetExceeded(`run budget $${budget.runUsd} spent`);
}

export function cost(model: string, inTok: number, outTok: number) {
  const [pi, po] = PRICES[model.split("/").pop()!] ?? PRICES["claude-sonnet-5-5"]; // unknown models are priced like Sonnet
  return (inTok * pi + outTok * po) / 1e6;
}

export async function chat(system: string, user: string, { model = llm.model, maxTokens = 4000 } = {}): Promise<string> {
  if (!llm.baseUrl || !llm.apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY are required");
  checkBudget();
  const url = /\/v1$/.test(llm.baseUrl) ? `${llm.baseUrl}/chat/completions` : `${llm.baseUrl}/v1/chat/completions`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${llm.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j: any = await res.json();
      const i = j.usage?.prompt_tokens ?? 0, o = j.usage?.completion_tokens ?? 0, c = cost(model, i, o);
      usage.calls++; usage.inputTokens += i; usage.outputTokens += o; usage.usd += c;
      const m = (usage.byModel[model] ??= { calls: 0, in: 0, out: 0, usd: 0 });
      m.calls++; m.in += i; m.out += o; m.usd += c;
      addToLedger(c);
      return j.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      if (attempt >= 2) { usage.failures++; throw e; }
      await Bun.sleep(2000 * (attempt + 1));
    }
  }
}

/** One Responses API call with the provider's web_search tool. Returns the final text; tokens and cost are tracked. */
export async function searchingModel(prompt: string, { model = llm.researchModel } = {}): Promise<string> {
  if (!llm.baseUrl || !llm.apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY are required");
  checkBudget();
  const url = /\/v1$/.test(llm.baseUrl) ? `${llm.baseUrl}/responses` : `${llm.baseUrl}/v1/responses`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${llm.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: prompt }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j: any = await res.json();
      const i = j.usage?.input_tokens ?? 0, o = j.usage?.output_tokens ?? 0, c = cost(model, i, o);
      usage.calls++; usage.inputTokens += i; usage.outputTokens += o; usage.usd += c;
      const m = (usage.byModel[model] ??= { calls: 0, in: 0, out: 0, usd: 0 });
      m.calls++; m.in += i; m.out += o; m.usd += c;
      addToLedger(c);
      return (j.output ?? []).filter((x: any) => x.type === "message").flatMap((x: any) => x.content ?? []).map((c: any) => c.text ?? "").join("\n");
    } catch (e) {
      if (attempt >= 2) { usage.failures++; throw e; }
      await Bun.sleep(3000 * (attempt + 1));
    }
  }
}
