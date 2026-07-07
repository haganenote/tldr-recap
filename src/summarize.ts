// src/summarize.ts
// Calls the Anthropic API directly in batches of 75 items.

import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { config } from "./config";
import type { CleanItem } from "./filter";

export interface CategorizedItem {
  /** One of the canonical categories below. */
  category: Category;
  /** Original headline, possibly cleaned up. */
  headline: string;
  /** One-sentence summary in clean English, no marketing tone. */
  summary: string;
  /** Original URL (preserved through the LLM round-trip). */
  url: string;
  /**
   * Career relevance score for a mid-level full-stack/AI engineer aiming for
   * senior/lead/manager: 3 = high, 2 = medium, 1 = low.
   */
  relevance: 1 | 2 | 3;
}

export const CATEGORIES = [
  "AI & Machine Learning",
  "Big Tech & Startups",
  "Programming & Infrastructure",
  "Science & Research",
  "Miscellaneous",
] as const;
export type Category = (typeof CATEGORIES)[number];

const SYSTEM_PROMPT = `You are a careful editor producing a daily tech-news recap for a specific reader.

Reader profile:
- Mid-level full-stack software engineer, 46 years old, aiming for senior/lead/manager
- Works at a large travel company (FCTG)
- Daily stack: Kubernetes, TypeScript, JavaScript, Ruby on Rails, Python, AI integration, LLM orchestration, backend services, message queues, frontend
- Career goal: stay ahead of AI trends, build technical leadership credibility, grow into senior/lead/manager roles

Given a JSON array of news items (each with id, headline, raw_summary, url, source_section), produce a JSON object with the same items.

For each item:
- Pick the single best category from this list:
${CATEGORIES.map((c) => `  - "${c}"`).join("\n")}
  Use "Miscellaneous" only when the item genuinely fits nowhere else.
- Write a clean one-sentence summary (max ~25 words). Neutral tone, no hype, no marketing copy. State what happened or what was found.
- Assign a career relevance score (integer 1-3) based on how useful this item is for the reader's career advancement:
  - 3 (high): AI/LLM advances, agent frameworks, k8s/cloud patterns, software architecture, engineering leadership, TS/JS/Python/RoR ecosystem, backend/queue patterns, travel-tech, management skills, product thinking, general engineering culture
  - 2 (medium): frontend trends, DevOps, security, startup ecosystem in tech
  - 1 (low): crypto/DeFi, consumer gadgets, marketing analytics, pure science, finance, sports, unrelated industries
- Preserve the url EXACTLY as given. Do not modify it.
- Preserve the id EXACTLY as given.

Output JSON only, no markdown fences, with this shape:

{
  "items": [
    { "id": "...", "category": "...", "headline": "...", "summary": "...", "url": "...", "relevance": 3 }
  ]
}

Do not invent items. Do not drop items. The output array must have the same length as the input array.`;

class TruncationError extends Error {
  constructor() {
    super("Anthropic API truncated output (stop_reason=max_tokens)");
    this.name = "TruncationError";
  }
}

const BATCH_SIZE = 75;
// Haiku 4.5's output ceiling is 64K tokens; 16K was too tight for dense
// batches and caused frequent truncation.
const MAX_TOKENS = 32_000;
// Below this, a truncating batch isn't "too big" — something else is wrong
// (e.g. a single malformed item) — stop splitting and let the error surface.
const MIN_SPLITTABLE_BATCH = 6;

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

type LlmInputItem = {
  id: string;
  headline: string;
  raw_summary: string;
  url: string;
  source_section: string;
};

async function callAnthropic(
  batchItems: LlmInputItem[],
): Promise<Array<Partial<CategorizedItem> & { id?: string }>> {
  const stream = client.messages.stream({
    model: config.anthropic.model,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify({ items: batchItems }) }],
  });
  const message = await stream.finalMessage();

  const textBlock = message.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : undefined;
  if (!content) throw new Error("Anthropic API returned no content");

  if (message.stop_reason === "max_tokens") {
    throw new TruncationError();
  }

  let parsed: { items?: Array<Partial<CategorizedItem> & { id?: string }> };
  try {
    const trimmed = content.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1) throw new SyntaxError("no JSON object found");
    parsed = JSON.parse(jsonrepair(trimmed.slice(start, end + 1)));
  } catch (parseErr) {
    throw new Error(
      `Anthropic API returned non-JSON (stop_reason=${message.stop_reason}, parse=${(parseErr as Error).message}): ` +
      `START=${content.slice(0, 200)} … END=${content.slice(-200)}`,
    );
  }

  return parsed.items ?? [];
}

/**
 * Resolves one batch, recovering from truncation by splitting the batch in
 * half and retrying the halves — a batch that's too dense to summarize
 * within the token budget needs to shrink, not repeat identically.
 */
async function resolveBatch(
  batch: LlmInputItem[],
  label: string,
): Promise<Array<Partial<CategorizedItem> & { id?: string }>> {
  try {
    return await callAnthropic(batch);
  } catch (e) {
    if (e instanceof TruncationError && batch.length > MIN_SPLITTABLE_BATCH) {
      console.log(
        `[${new Date().toISOString()}] ${label} truncated at ${batch.length} items, splitting in half…`,
      );
      const mid = Math.ceil(batch.length / 2);
      const first = await resolveBatch(batch.slice(0, mid), `${label}a`);
      await new Promise((r) => setTimeout(r, 5_000));
      const second = await resolveBatch(batch.slice(mid), `${label}b`);
      return [...first, ...second];
    }
    console.log(`[${new Date().toISOString()}] ${label} failed (${(e as Error).message}), retrying in 15s…`);
    await new Promise((r) => setTimeout(r, 15_000));
    return await callAnthropic(batch); // let a second failure propagate
  }
}

export async function summarizeAndCategorize(
  items: CleanItem[],
): Promise<CategorizedItem[]> {
  if (items.length === 0) return [];

  const llmInput = items.map((it, idx) => ({
    id: `item-${idx}`,
    headline: it.headline,
    raw_summary: it.summary.slice(0, 600),
    url: it.canonicalUrl,
    source_section: it.section,
  }));

  const out: CategorizedItem[] = [];
  for (let i = 0; i < llmInput.length; i += BATCH_SIZE) {
    const batch = llmInput.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(llmInput.length / BATCH_SIZE);
    console.log(`[${new Date().toISOString()}] summarizing batch ${batchNum}/${totalBatches} (${batch.length} items)`);
    if (i > 0) await new Promise((r) => setTimeout(r, 10_000)); // 10s between batches to avoid rate limits
    const rawItems = await resolveBatch(batch, `batch ${batchNum}/${totalBatches}`);
    for (const raw of rawItems) {
      if (!raw.headline || !raw.summary || !raw.url || !raw.category) continue;
      if (!CATEGORIES.includes(raw.category as Category)) {
        raw.category = "Miscellaneous";
      }
      const relevance = [1, 2, 3].includes(raw.relevance as number)
        ? (raw.relevance as 1 | 2 | 3)
        : 2;
      out.push({
        headline: raw.headline,
        summary: raw.summary,
        url: raw.url,
        category: raw.category as Category,
        relevance,
      });
    }
  }

  return out;
}
