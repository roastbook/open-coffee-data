import { expect, test } from "bun:test";
import { cost } from "../src/llm";

test("estimated cost per model, research model included", () => {
  expect(cost("claude/claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
  expect(cost("cx/gpt-5.6-luna", 1_000_000, 0)).toBeCloseTo(1.25);
});
