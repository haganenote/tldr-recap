// src/summarize.ts
// Calls OpenRouter in batches of 50 items to avoid context/timeout limits.
// Uses fetch directly (no SDK) so swapping models is a one-env-var change.

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

const BATCH_SIZE = 25;
const TIMEOUT_MS = 120_000;

async function callOpenRouter(
  batchItems: Array<{ id: string; headline: string; raw_summary: string; url: string; source_section: string }>,
): Promise<Array<Partial<CategorizedItem> & { id?: string }>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`OpenRouter batch timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        "HTTP-Referer": "https://github.com/tldr-recap",
        "X-Title": "tldr-recap",
      },
      body: JSON.stringify({
        model: config.openrouter.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ items: batchItems }) },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (!content) throw new Error("OpenRouter returned no content");

    const finishReason = choice?.finish_reason ?? "unknown";
    if (finishReason === "length") {
      throw new Error(`OpenRouter truncated output (finish_reason=length) — batch too large or max_tokens too low`);
    }

    let parsed: { items?: Array<Partial<CategorizedItem> & { id?: string }> };
    try {
      const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      parsed = JSON.parse(stripped);
    } catch {
      throw new Error(`OpenRouter returned non-JSON (finish_reason=${finishReason}): ${content.slice(0, 300)}`);
    }

    return parsed.items ?? [];
  } finally {
    clearTimeout(timeoutId);
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
    let rawItems: Awaited<ReturnType<typeof callOpenRouter>>;
    try {
      rawItems = await callOpenRouter(batch);
    } catch (e) {
      console.log(`[${new Date().toISOString()}] batch ${batchNum} failed (${(e as Error).message}), retrying in 15s…`);
      await new Promise((r) => setTimeout(r, 15_000));
      rawItems = await callOpenRouter(batch); // let second failure propagate
    }
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
