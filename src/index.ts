// src/index.ts
// Entry point. Run once per day from systemd timer.

import { config } from "./config";
import {
  fetchRecentRawMessages,
  markMessageProcessed as markGmailProcessed,
  sendEmail,
} from "./gmail";
import { parseTldrEmail } from "./parser";
import { filterAndDedup, markBatchSeen } from "./filter";
import { summarizeAndCategorize, type CategorizedItem } from "./summarize";
import { renderErrorEmail, renderRecapHtml } from "./render";
import {
  isMessageProcessed,
  markMessageProcessed as markStateProcessed,
  pruneOldEntries,
} from "./state";

async function main(): Promise<void> {
  log("starting tldr-recap");
  pruneOldEntries();

  // 1. Fetch
  if (config.force) log("--force: ignoring is:unread / newer_than:1d");
  const messages = await fetchRecentRawMessages({ force: config.force });
  log(`fetched ${messages.length} raw messages`);

  if (messages.length === 0) {
    log("no new TLDR emails today; exiting cleanly");
    return;
  }

  // 2. Parse all messages, accumulate items
  const allItems = [];
  const editions = new Set<string>();
  const messageIds: string[] = [];

  for (const msg of messages) {
    if (isMessageProcessed(msg.id)) {
      log(`skipping already-processed message ${msg.id}`);
      continue;
    }
    try {
      const parsed = parseTldrEmail(msg.subject, msg.body);
      log(
        `parsed "${msg.subject}" (${parsed.edition}): ${parsed.items.length} items`,
      );
      editions.add(parsed.edition);
      allItems.push(...parsed.items);
      messageIds.push(msg.id);
    } catch (e) {
      log(`parse error on ${msg.subject}: ${(e as Error).message}`);
      // Don't bail entirely; other emails may still be parseable.
    }
  }

  // 3. Strict-mode threshold
  if (allItems.length < config.minItemsBeforeFailure) {
    throw new Error(
      `Strict mode: only ${allItems.length} items extracted from ${messages.length} emails (threshold: ${config.minItemsBeforeFailure}). TLDR template may have changed.`,
    );
  }

  // 4. Filter ads + dedup
  const { items: cleaned, stats } = filterAndDedup(allItems);
  log(
    `after filter: ${stats.surviving}/${stats.totalItems} items (sponsors: ${stats.sponsorDropped}, dupes: ${stats.duplicateDropped})`,
  );

  if (cleaned.length === 0) {
    log("nothing left after filtering; exiting without sending");
    // Still mark messages processed so we don't re-fetch them tomorrow.
    for (const id of messageIds) {
      await markGmailProcessed(id);
      markStateProcessed(id);
    }
    return;
  }

  // 5. Summarize + categorize via the Anthropic API
  let categorized: CategorizedItem[];
  try {
    categorized = await summarizeAndCategorize(cleaned);
    log(`categorized ${categorized.length} items via Anthropic API`);
  } catch (e) {
    // Fail loud — error email path. Don't try to send a degraded recap;
    // user explicitly chose error-email failure mode.
    throw new Error(`Anthropic API failure: ${(e as Error).message}`);
  }

  // 6. Render + send
  const html = renderRecapHtml({
    items: categorized,
    stats,
    date: new Date(),
    editions: [...editions].sort(),
  });

  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  await sendEmail({
    to: config.recipient,
    subject: `TLDR Recap — ${today}`,
    htmlBody: html,
  });
  log(`recap sent to ${config.recipient}`);

  // 7. Mark processed (only after successful send)
  markBatchSeen(cleaned);
  for (const id of messageIds) {
    await markGmailProcessed(id);
    markStateProcessed(id);
  }
  log(`marked ${messageIds.length} messages as processed`);
}

async function sendErrorEmail(error: Error, context: string): Promise<void> {
  try {
    const html = renderErrorEmail(error, context);
    await sendEmail({
      to: config.recipient,
      subject: `⚠️ tldr-recap failed — ${new Date().toLocaleDateString("en-CA")}`,
      htmlBody: html,
    });
    log("error email sent");
  } catch (e) {
    log(`failed to send error email: ${(e as Error).message}`);
  }
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- Run ----
// Hard backstop: Bun's fetch can hang indefinitely even with AbortController.
// 20 minutes covers worst-case batches plus truncation-recovery splits, with room to spare.
const hardDeadline = setTimeout(() => {
  log("FATAL: hard 20-minute deadline exceeded — force exiting");
  process.exit(2);
}, 20 * 60 * 1000);
hardDeadline.unref();

try {
  await main();
  log("done");
  process.exit(0);
} catch (e) {
  const err = e as Error;
  log(`FATAL: ${err.message}`);
  console.error(err.stack);
  await sendErrorEmail(err, "main");
  process.exit(1);
}
