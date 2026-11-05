// Prompt-injection guard. Fetched page text is data, never instructions:
// - instructions live only in the system prompt;
// - page text is fenced with a random nonce the page cannot predict, and any fence-like text inside it is defused;
// - lines that address an AI model are dropped (and counted);
// - the model output must validate against a JSON Schema, and every value is checked against the page (evidence.ts).
import { randomBytes } from "node:crypto";
import { Ajv } from "ajv";

const INJECTION = /\b(ignore|disregard|forget)\b.{0,40}\b(previous|above|prior|all|earlier)\b.{0,40}\b(instructions?|prompts?|rules?)\b|\b(system prompt|you are (now )?(an?|the) (ai|assistant|language model|llm)|as an ai\b|chatgpt|large language model|assistant:|<\/?(system|assistant|user)>)|\b(ignoriere|vergiss)\b.{0,40}\b(anweisungen|vorherigen|regeln)\b/i;

export function stripInjection(text: string): { text: string; removed: number } {
  let removed = 0;
  const lines = text.split("\n").filter((l) => {
    if (INJECTION.test(l)) { removed++; return false; }
    return true;
  });
  return { text: lines.join("\n"), removed };
}

export function fence(label: string, text: string): { block: string; nonce: string; removed: number } {
  const nonce = randomBytes(9).toString("hex");
  const clean = stripInjection(text);
  const body = clean.text.replace(/<\/?untrusted[^>]*>/gi, "[tag removed]");
  return { block: `<untrusted id="${nonce}" source="${label}">\n${body}\n</untrusted id="${nonce}">`, nonce, removed: clean.removed };
}

const ajv = new Ajv({ allErrors: true, strict: false });
/** Parse a model reply as JSON (tolerating a ```json fence) and validate it; throws with the schema errors. */
export function parseOutput<T>(reply: string, schema: object): T {
  const m = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : reply).trim();
  const start = raw.search(/[{[]/);
  const data = JSON.parse(start > 0 ? raw.slice(start) : raw);
  const validate = ajv.compile(schema);
  if (!validate(data)) throw new Error("model output does not match schema: " + ajv.errorsText(validate.errors));
  return data as T;
}
