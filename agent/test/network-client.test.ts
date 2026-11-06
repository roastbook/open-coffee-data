import { expect, spyOn, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CACHE, llm } from "../src/config";
import { chat, searchingModel, usage } from "../src/llm";

function removeReply(key: object) {
  const file = join(CACHE, "llm", createHash("sha1").update(JSON.stringify(key)).digest("hex") + ".json");
  if (existsSync(file)) unlinkSync(file);
}

test("model clients account responses and reuse cached replies without another request", async () => {
  const original = { ...llm };
  const model = `network-test-${randomUUID()}`;
  const prompt = randomUUID();
  llm.baseUrl = "https://provider.example/v1";
  llm.apiKey = "test-key";
  const fetcher = spyOn(globalThis, "fetch");
  const before = { ...usage };
  try {
    fetcher.mockResolvedValueOnce(Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: "coffee" } }] }));
    expect(await chat("system", prompt, { model })).toBe("coffee");
    expect(await chat("system", prompt, { model })).toBe("coffee");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
    expect(usage.byModel[model].calls).toBe(1);
    expect(usage.inputTokens - before.inputTokens).toBe(10);
    expect(usage.outputTokens - before.outputTokens).toBe(5);
    expect((usage.cached ?? 0) - (before.cached ?? 0)).toBe(1);
    fetcher.mockResolvedValueOnce(Response.json({ usage: { input_tokens: 20, output_tokens: 8 }, output: [{ type: "web_search_call" }, { type: "message", content: [{ text: "first" }, { text: "second" }] }] }));
    expect(await searchingModel(prompt, { model })).toBe("first\nsecond");
    expect(usage.byModel[model].calls).toBe(2);
    expect((usage.searches ?? 0) - (before.searches ?? 0)).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    fetcher.mockRestore();
    Object.assign(llm, original);
    removeReply({ model, system: "system", user: prompt });
    removeReply({ model, prompt, tool: "web_search" });
  }
});

test("client errors are not retried and missing configuration makes no request", async () => {
  const original = { ...llm };
  const fetcher = spyOn(globalThis, "fetch");
  const prompt = randomUUID();
  try {
    llm.baseUrl = "https://provider.example";
    llm.apiKey = "test-key";
    fetcher.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    await expect(chat("system", prompt)).rejects.toThrow("LLM HTTP 400");
    expect(fetcher).toHaveBeenCalledTimes(1);
    llm.apiKey = "";
    await expect(chat("system", prompt)).rejects.toThrow("LLM_BASE_URL and LLM_API_KEY are required");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    fetcher.mockRestore();
    Object.assign(llm, original);
  }
});
