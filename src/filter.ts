// src/filter.ts
// Apply ad filtering, URL canonicalization, and cross-edition dedup.

import type { ParsedItem } from "./parser";
import { canonicalizeUrl, getDomain, hashUrl } from "./url";
import {
  getSponsorDomains,
  isUrlSeen,
  loadSponsorDomainsFromFile,
  markUrlSeen,
} from "./state";

export interface CleanItem extends ParsedItem {
  canonicalUrl: string;
  urlHash: string;
}

export interface FilterStats {
  totalItems: number;
  sponsorDropped: number;
  duplicateDropped: number;
  noUrlDropped: number;
  surviving: number;
}

export function filterAndDedup(
  items: ParsedItem[],
): { items: CleanItem[]; stats: FilterStats } {
  const sponsorDomainsDb = getSponsorDomains();
  const sponsorDomainsFile = loadSponsorDomainsFromFile();
  const sponsorDomains = new Set([...sponsorDomainsDb, ...sponsorDomainsFile]);

  const stats: FilterStats = {
    totalItems: items.length,
    sponsorDropped: 0,
    duplicateDropped: 0,
    noUrlDropped: 0,
    surviving: 0,
  };

  const seenInThisRun = new Set<string>();
  const out: CleanItem[] = [];

  for (const item of items) {
    if (!item.url) {
      stats.noUrlDropped++;
      continue;
    }

    if (item.isSponsor) {
      stats.sponsorDropped++;
      continue;
    }

    const domain = getDomain(item.url);
    if (domain && sponsorDomains.has(domain)) {
      stats.sponsorDropped++;
      continue;
    }

    const canonical = canonicalizeUrl(item.url);
    const hash = hashUrl(canonical);

    // Cross-edition dedup within this run.
    if (seenInThisRun.has(hash)) {
      stats.duplicateDropped++;
      continue;
    }

    // Cross-day dedup against persistent state.
    if (isUrlSeen(hash)) {
      stats.duplicateDropped++;
      continue;
    }

    seenInThisRun.add(hash);
    out.push({ ...item, canonicalUrl: canonical, urlHash: hash });
  }

  stats.surviving = out.length;
  return { items: out, stats };
}

/** Persist the URLs we surfaced today so we don't re-show them tomorrow. */
export function markBatchSeen(items: CleanItem[]): void {
  for (const item of items) {
    markUrlSeen(item.urlHash, item.canonicalUrl);
  }
}
