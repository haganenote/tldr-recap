// src/url.ts
// Canonicalize URLs so the same article from different TLDR editions hashes the same.

import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set([
  // UTM
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  // Mailchimp
  "mc_cid",
  "mc_eid",
  // TLDR-specific
  "ref",
  "ref_src",
  // Substack
  "publication_id",
  "post_id",
  "isFreemail",
  "r",
  // Generic
  "fbclid",
  "gclid",
  "msclkid",
  "yclid",
  "_hsenc",
  "_hsmi",
  "_kx",
  "ck_subscriber_id",
]);

export function canonicalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // Not a real URL; return as-is. Hashing will still dedup exact matches.
    return input.trim();
  }

  // Lowercase host
  url.hostname = url.hostname.toLowerCase();

  // Strip tracking params
  const cleanedParams = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) {
      cleanedParams.set(k, v);
    }
  }
  url.search = cleanedParams.toString();

  // Trim trailing slash from path (but keep root /)
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // Drop fragment (rarely meaningful for article identity)
  url.hash = "";

  return url.toString();
}

export function hashUrl(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16);
}

export function getDomain(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
