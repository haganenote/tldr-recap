// src/state.ts
// SQLite for: dedup history, processed message IDs, sponsor domain blocklist.
// Bun ships with bun:sqlite — no native deps.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.STATE_DB_PATH ?? "./data/state.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_urls (
    url_hash TEXT PRIMARY KEY,
    canonical_url TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS processed_messages (
    message_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sponsor_domains (
    domain TEXT PRIMARY KEY,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Auto-prune URLs older than 30 days; we don't need infinite memory
  -- (TLDR rarely re-runs the same story after a month).
`);

const stmtIsUrlSeen = db.query<{ url_hash: string }, [string]>(
  "SELECT url_hash FROM seen_urls WHERE url_hash = ?",
);
const stmtMarkUrlSeen = db.query(
  "INSERT OR IGNORE INTO seen_urls (url_hash, canonical_url) VALUES (?, ?)",
);
const stmtIsMessageProcessed = db.query<{ message_id: string }, [string]>(
  "SELECT message_id FROM processed_messages WHERE message_id = ?",
);
const stmtMarkMessageProcessed = db.query(
  "INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)",
);
const stmtListSponsorDomains = db.query<{ domain: string }, []>(
  "SELECT domain FROM sponsor_domains",
);
const stmtPruneOldUrls = db.query(
  "DELETE FROM seen_urls WHERE first_seen_at < datetime('now', '-30 days')",
);
const stmtPruneOldMessages = db.query(
  "DELETE FROM processed_messages WHERE processed_at < datetime('now', '-90 days')",
);

export function isUrlSeen(urlHash: string): boolean {
  return stmtIsUrlSeen.get(urlHash) !== null;
}

export function markUrlSeen(urlHash: string, canonicalUrl: string): void {
  stmtMarkUrlSeen.run(urlHash, canonicalUrl);
}

export function isMessageProcessed(messageId: string): boolean {
  return stmtIsMessageProcessed.get(messageId) !== null;
}

export function markMessageProcessed(messageId: string): void {
  stmtMarkMessageProcessed.run(messageId);
}

export function getSponsorDomains(): Set<string> {
  return new Set(stmtListSponsorDomains.all().map((r) => r.domain));
}

export function pruneOldEntries(): void {
  stmtPruneOldUrls.run();
  stmtPruneOldMessages.run();
}

// Load extra sponsor domains from a flat file (easy to edit by hand).
import { existsSync, readFileSync } from "node:fs";
export function loadSponsorDomainsFromFile(
  path = "./data/sponsor-domains.txt",
): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0 && !l.startsWith("#")),
  );
}
