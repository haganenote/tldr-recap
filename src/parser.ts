// src/parser.ts
// Parses a TLDR newsletter email into structured items.
//
// TLDR's HTML structure is consistent enough to handle without an LLM:
//   - Section headers are <h2> or styled <p>/<span> with ALL-CAPS text like
//     "BIG TECH & STARTUPS", "PROGRAMMING, DESIGN & DATA SCIENCE", etc.
//   - Each item is a headline (often a link) followed by a short paragraph,
//     with read time annotation like "(3 minute read)".
//   - Sponsor items either:
//       (a) live under a section labeled "TOGETHER WITH ..." or "SPONSOR"
//       (b) have "(Sponsor)" appended to the headline
//
// Strict mode: if extracted item count is suspicious (0, or page has expected
// sections but they're empty), the caller will throw. We don't throw here;
// we return what we found and let the caller decide.

import { parse, type HTMLElement } from "node-html-parser";

export interface ParsedItem {
  /** The visible headline. */
  headline: string;
  /** Body paragraph (readable text, no HTML). */
  summary: string;
  /** First outbound link in the item, or null if none. */
  url: string | null;
  /** Section heading this item appeared under. */
  section: string;
  /** True if heuristics flagged this as sponsored content. */
  isSponsor: boolean;
  /** "X minute read" / "X minute listen" if found. */
  readTime: string | null;
}

export interface ParsedEmail {
  /** Email subject ("TLDR 2026-04-25" / "TLDR AI 2026-04-25" etc.) */
  subject: string;
  /** Best-guess edition name extracted from subject. */
  edition: string;
  items: ParsedItem[];
}

const SPONSOR_SECTION_PATTERNS = [
  /^together with\b/i,
  /^sponsor(s|ed)?$/i,
  /^our sponsor/i,
];

const SPONSOR_HEADLINE_MARKER = /\(sponsor\)/i;

const SECTION_HEADING_REGEX = /^[A-Z0-9][A-Z0-9 ,&'\-]{2,}$/;

const READ_TIME_REGEX = /\((\d+)\s*minute\s*(read|listen|watch)\)/i;

export function parseTldrEmail(subject: string, html: string): ParsedEmail {
  const root = parse(html, {
    lowerCaseTagName: false,
    blockTextElements: { script: false, style: false },
  });

  // Drop scripts/styles outright.
  root.querySelectorAll("script,style").forEach((n) => n.remove());

  const edition = extractEdition(subject);

  // Strategy: walk text content top-to-bottom. Whenever we hit a line that
  // looks like a section heading (ALL CAPS, short-ish), set current section.
  // Whenever we hit a link with non-trivial anchor text, treat that link's
  // headline as a candidate item; the next paragraph of text is its summary.
  //
  // This is more robust than trying to match TLDR's specific table-based
  // layout, which they tweak occasionally.

  const items: ParsedItem[] = [];
  let currentSection = "UNCATEGORIZED";
  let currentSectionIsSponsor = false;

  // Flatten the document into ordered nodes of interest.
  const nodes = collectOrderedNodes(root);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    if (node.kind === "heading") {
      currentSection = node.text;
      currentSectionIsSponsor = SPONSOR_SECTION_PATTERNS.some((re) =>
        re.test(node.text),
      );
      continue;
    }

    if (node.kind === "link" && node.text.length > 8) {
      // Look ahead for the summary paragraph (next text-ish node before the
      // next link or heading).
      let summary = "";
      for (let j = i + 1; j < nodes.length; j++) {
        const next = nodes[j]!;
        if (next.kind === "heading" || next.kind === "link") break;
        if (next.kind === "text" && next.text.length > 30) {
          summary = next.text;
          break;
        }
      }

      const headline = node.text.replace(/\s+/g, " ").trim();
      const readTimeMatch =
        headline.match(READ_TIME_REGEX) ?? summary.match(READ_TIME_REGEX);
      const cleanHeadline = headline.replace(READ_TIME_REGEX, "").trim();

      const isSponsor =
        currentSectionIsSponsor ||
        SPONSOR_HEADLINE_MARKER.test(headline) ||
        SPONSOR_HEADLINE_MARKER.test(summary);

      // Skip footer/utility links — "unsubscribe", "manage preferences", etc.
      if (isLikelyFooterLink(cleanHeadline, node.href)) continue;

      items.push({
        headline: cleanHeadline,
        summary: summary.replace(/\s+/g, " ").trim(),
        url: node.href,
        section: currentSection,
        isSponsor,
        readTime: readTimeMatch ? readTimeMatch[0].slice(1, -1) : null,
      });
    }
  }

  return { subject, edition, items };
}

function extractEdition(subject: string): string {
  // Examples:
  //   "TLDR 2026-04-25"           -> "TLDR"
  //   "TLDR AI 2026-04-25"        -> "TLDR AI"
  //   "TLDR Web Dev 04-25-2026"   -> "TLDR Web Dev"
  const stripped = subject
    .replace(/[\d\-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || "TLDR";
}

interface OrderedNode {
  kind: "heading" | "link" | "text";
  text: string;
  href: string | null;
}

function collectOrderedNodes(root: HTMLElement): OrderedNode[] {
  const out: OrderedNode[] = [];

  const walk = (el: HTMLElement) => {
    const tag = el.tagName?.toUpperCase();

    // Treat <a> as a link node, but only if it has a real href.
    if (tag === "A") {
      const href = el.getAttribute("href")?.trim() ?? null;
      const text = el.text.replace(/\s+/g, " ").trim();
      if (href && text && /^https?:\/\//i.test(href)) {
        out.push({ kind: "link", text, href });
      }
      return; // don't descend further; we've captured the anchor as a unit
    }

    // Headings and heading-like elements.
    if (tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4") {
      const text = el.text.replace(/\s+/g, " ").trim();
      if (text) {
        out.push({ kind: "heading", text, href: null });
        return;
      }
    }

    // For paragraph-like elements with no children of interest, capture text.
    if (
      tag === "P" ||
      tag === "DIV" ||
      tag === "SPAN" ||
      tag === "TD" ||
      tag === "STRONG" ||
      tag === "B"
    ) {
      // Only capture the leaf text if this element has no anchor/heading
      // descendants (otherwise we'd double-count).
      const hasInteresting = el.querySelector("a, h1, h2, h3, h4");
      if (!hasInteresting) {
        const text = el.text.replace(/\s+/g, " ").trim();
        if (text) {
          // Treat ALL-CAPS short text as section heading even if not in <h*>.
          if (text.length <= 60 && SECTION_HEADING_REGEX.test(text)) {
            out.push({ kind: "heading", text, href: null });
          } else if (text.length > 30) {
            out.push({ kind: "text", text, href: null });
          }
        }
        return;
      }
    }

    // Recurse for everything else.
    for (const child of el.childNodes) {
      if ((child as HTMLElement).tagName !== undefined) {
        walk(child as HTMLElement);
      }
    }
  };

  walk(root);
  return out;
}

function isLikelyFooterLink(headline: string, url: string | null): boolean {
  const h = headline.toLowerCase();
  if (
    /^(unsubscribe|manage (your )?preferences|update preferences|view in browser|view online|read online|advertise|forward|share|privacy policy|terms)/.test(
      h,
    )
  ) {
    return true;
  }
  if (url) {
    const u = url.toLowerCase();
    if (/unsubscribe|manage_preferences|email_preferences/.test(u)) return true;
  }
  return false;
}
