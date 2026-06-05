// src/render.ts
// Pure HTML, clean and minimal. System fonts, no external assets, dark-mode
// friendly via CSS variables that respect prefers-color-scheme.

import { CATEGORIES, type CategorizedItem } from "./summarize";
import type { FilterStats } from "./filter";

export interface RenderOpts {
  items: CategorizedItem[];
  stats: FilterStats;
  date: Date;
  editions: string[];
}

export function renderRecapHtml(opts: RenderOpts): string {
  const { items, stats, date, editions } = opts;
  const dateStr = date.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const high = items.filter((i) => i.relevance === 3).sort(byCategoryThenHeadline);
  const mid = items.filter((i) => i.relevance === 2).sort(byCategoryThenHeadline);
  const low = items.filter((i) => i.relevance === 1).sort(byCategoryThenHeadline);

  const sections = [
    renderTier("Must read", high, "relevance-high"),
    mid.length > 0 ? `<hr class="tier-divider"><p class="tier-label">Worth a glance</p>${renderItemList(mid, "relevance-mid")}` : "",
    low.length > 0 ? `<hr class="tier-divider"><p class="tier-label">Low priority</p>${renderItemList(low, "relevance-low")}` : "",
  ].join("\n");

  const editionsLine =
    editions.length > 0
      ? `From: ${editions.map(escapeHtml).join(", ")}`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TLDR Recap — ${escapeHtml(dateStr)}</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #1a1a1a;
    --muted: #666666;
    --accent: #2563eb;
    --border: #e5e5e5;
    --section-bg: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a1a;
      --fg: #e5e5e5;
      --muted: #999999;
      --accent: #60a5fa;
      --border: #333333;
      --section-bg: #222222;
    }
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--bg);
    color: var(--fg);
    margin: 0;
    padding: 24px 16px;
    line-height: 1.5;
  }
  .container { max-width: 640px; margin: 0 auto; }
  header { border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 13px; }
  h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 32px 0 12px;
    font-weight: 600;
  }
  .item { margin-bottom: 18px; }
  .item-headline {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .item-headline a {
    color: var(--accent);
    text-decoration: none;
  }
  .item-headline a:hover { text-decoration: underline; }
  .item-summary {
    color: var(--fg);
    font-size: 14px;
    margin: 0;
  }
  .relevance-high { border-left: 3px solid #22c55e; padding-left: 10px; }
  .relevance-mid { border-left: 3px solid #f59e0b; padding-left: 10px; opacity: 0.85; }
  .relevance-low { border-left: 3px solid #e5e5e5; padding-left: 10px; opacity: 0.6; }
  .tier-divider {
    border: none;
    border-top: 1px dashed var(--border);
    margin: 24px 0 8px;
  }
  .tier-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 12px;
  }
  footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
  }
  .stat-pill {
    display: inline-block;
    background: var(--section-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2px 8px;
    margin-right: 6px;
    font-size: 11px;
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>TLDR Recap</h1>
    <div class="meta">${escapeHtml(dateStr)}${editionsLine ? ` · ${editionsLine}` : ""}</div>
  </header>

  ${sections}

  <footer>
    <span class="stat-pill">${stats.totalItems} items found</span>
    <span class="stat-pill">${stats.sponsorDropped} ads filtered</span>
    <span class="stat-pill">${stats.duplicateDropped} duplicates merged</span>
    <span class="stat-pill">${stats.surviving} in this recap</span>
  </footer>
</div>
</body>
</html>`;
}

function renderTier(label: string, items: CategorizedItem[], cls: string): string {
  if (items.length === 0) return "";
  return `<p class="tier-label">${escapeHtml(label)}</p>${renderItemList(items, cls)}`;
}

function renderItemList(items: CategorizedItem[], cls: string): string {
  return items.map((item) => `
    <div class="item ${cls}">
      <div class="item-headline">
        <a href="${escapeHtml(item.url)}">${escapeHtml(item.headline)}</a>
        <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:6px;">${escapeHtml(item.category)}</span>
      </div>
      <p class="item-summary">${escapeHtml(item.summary)}</p>
    </div>`).join("\n");
}

function byCategoryThenHeadline(a: CategorizedItem, b: CategorizedItem): number {
  return a.category.localeCompare(b.category) || a.headline.localeCompare(b.headline);
}

export function renderErrorEmail(error: Error, context: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family: monospace; padding: 16px;">
<h2>tldr-recap failed</h2>
<p><strong>Context:</strong> ${escapeHtml(context)}</p>
<p><strong>Error:</strong> ${escapeHtml(error.message)}</p>
<pre style="background: #f5f5f5; padding: 12px; overflow-x: auto;">${escapeHtml(error.stack ?? "")}</pre>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
