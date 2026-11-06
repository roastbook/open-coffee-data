import { payloadParser, stringValue, numberValue } from "./payload";
// Opens one pull request per city through the GitHub API as the roastbook-sourcing GitHub App (GH_TOKEN = installation token).
// The commit is created with createCommitOnBranch, so GitHub signs it. Never merges: every PR gets human review.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { REPO } from "./config";
import type { Change } from "./pipeline";

const REPOSITORY = process.env.GITHUB_REPOSITORY ?? "Roastbook/open-coffee-data";
const ALLOWED = "datasets/coffee-places/"; // the data agent may change nothing else

async function gh(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.text();
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

const gitReference = payloadParser<{ object: { sha: string } }>({ type: "object", required: ["object"], properties: { object: { type: "object", required: ["sha"], properties: { sha: stringValue } } } });
const pullRequest = payloadParser<{ number: number; html_url: string }>({ type: "object", required: ["number", "html_url"], properties: { number: numberValue, html_url: stringValue } });
const graphqlReply = payloadParser<{ errors?: unknown[] }>({ type: "object", properties: { errors: { type: "array" } } });

/** Text from fetched pages is untrusted: no @mentions, images, links or HTML in the PR body. */
export const esc = (s: string) => s.replace(/@/g, "@\u200b").replace(/!\[/g, "!\u200b[").replace(/\]\(/g, "]\u200b(").replace(/</g, "&lt;");
const fmt = (v: unknown) => (v === undefined ? "–" : "`" + esc(typeof v === "string" ? v : (JSON.stringify(v) ?? "")).replace(/`/g, "'").slice(0, 120) + "`");

export function prBody(city: string, changes: Change[], metrics: { run_id: string; places_touched: number; tiers: Record<string, number>; tier_ab_core_complete: number; llm: { calls: number; inputTokens: number; outputTokens: number; usd: number }; pages: { requests: number; disallowed: number } }, conflicts: { name: string; reason: string }[], labels: string[]) {
  const byField = new Map<string, Change[]>();
  for (const c of changes) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
  const lines = [
    `Data agent run \`${metrics.run_id}\` for **${city}**: ${metrics.places_touched} places touched, ${changes.length} field changes.`,
    "", "Every value below was confirmed on the linked page in this run (quoted snippets are checked in code to occur in the fetched text). Please review before merging; this PR is never merged automatically.",
    "", `Review flags: ${labels.length ? labels.map((l) => `\`${l}\``).join(", ") : "none"}.`, "",
    "| Metric | Value |", "|---|---|",
    `| Tiers (city) | A ${metrics.tiers.A}, B ${metrics.tiers.B}, none ${metrics.tiers.none} |`,
    `| Tier A/B with complete core fields | ${metrics.tier_ab_core_complete} |`,
    `| LLM | ${metrics.llm.calls} calls, ${metrics.llm.inputTokens + metrics.llm.outputTokens} tokens, $${metrics.llm.usd.toFixed(3)} |`,
    `| Pages fetched | ${metrics.pages.requests} requests, ${metrics.pages.disallowed} not fetched because of site rules |`,
    "",
  ];
  if (conflicts.length) lines.push("### Conflicts (need a human)", "", ...conflicts.map((c) => `- ${esc(c.name)}: ${esc(c.reason)}`), "");
  lines.push("### Changes by field", "");
  for (const [field, cs] of [...byField].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`<details><summary><code>${field}</code> (${cs.length})</summary>`, "");
    for (const c of cs.slice(0, 200)) lines.push(`- ${esc(c.name)} (\`${c.id}\`): ${fmt(c.old)} → ${fmt(c.new)}${c.url && /^https?:\/\/[^\s()<>]+$/.test(c.url) ? ` ([page](${c.url}))` : ""}${c.quote ? ` — “${esc(String(c.quote).replace(/\s+/g, " ").slice(0, 100))}”` : ""}`);
    lines.push("", "</details>");
  }
  const body = lines.join("\n");
  return body.length > 60000 ? body.slice(0, 60000) + "\n\n… truncated; the full run log is in the workflow artifact." : body;
}

export async function openPr(city: string, files: string[], title: string, body: string, labels: string[]) {
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN (roastbook-sourcing App installation token) is required to open a pull request");
  const paths = files.map((f) => relative(REPO, f));
  for (const p of paths) if (!p.startsWith(ALLOWED)) throw new Error(`refusing to commit ${p}: the data agent may only change datasets/coffee-places/**`);
  const main = gitReference(await gh(`/repos/${REPOSITORY}/git/ref/heads/main`));
  const branch = `data-agent/${city}-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
  await gh(`/repos/${REPOSITORY}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }) });
  try {
  const mutation = "mutation($i:CreateCommitOnBranchInput!){createCommitOnBranch(input:$i){commit{oid}}}";
  const additions = files.map((file) => ({ path: relative(REPO, file), contents: Buffer.from(readFileSync(file)).toString("base64") }));
  const res = graphqlReply(await gh("/graphql", { method: "POST", body: JSON.stringify({ query: mutation, variables: { i: { branch: { repositoryNameWithOwner: REPOSITORY, branchName: branch }, expectedHeadOid: main.object.sha, message: { headline: title }, fileChanges: { additions } } } }) }));
  if (res.errors) throw new Error(JSON.stringify(res.errors));
  const pr = pullRequest(await gh(`/repos/${REPOSITORY}/pulls`, { method: "POST", body: JSON.stringify({ title, head: branch, base: "main", body }) }));
  await gh(`/repos/${REPOSITORY}/issues/${pr.number}/labels`, { method: "POST", body: JSON.stringify({ labels: ["data-agent", ...labels] }) }).catch(() => { /* Labels are optional; keep the successfully opened PR. */ });
  return pr.html_url;
  } catch (e) {
    // No PR: remove the branch so failed runs do not pile up branches.
    await gh(`/repos/${REPOSITORY}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => { /* Preserve the original failure if branch cleanup also fails. */ });
    throw e;
  }
}
