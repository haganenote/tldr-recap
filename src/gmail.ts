// src/gmail.ts
// Thin Gmail API wrapper. Refresh-token auth (no interactive flow at runtime).

import { google, type gmail_v1 } from "googleapis";
import { config } from "./config";

function makeClient(): gmail_v1.Gmail {
  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
  );
  oauth2.setCredentials({ refresh_token: config.gmail.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

const gmail = makeClient();

export interface RawMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: Date;
  /** Decoded text/html body, or text/plain if no html. */
  body: string;
  /** Detected MIME type of `body`. */
  bodyType: "text/html" | "text/plain";
}

/** Resolve label name -> id, creating the label if it doesn't exist. */
async function ensureLabelId(name: string): Promise<string> {
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = list.data.labels?.find((l) => l.name === name);
  if (existing?.id) return existing.id;

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.data.id) throw new Error(`Failed to create label ${name}`);
  return created.data.id;
}

/** Find unread messages under the raw label received in the last 24h. */
export async function fetchRecentRawMessages(): Promise<RawMessage[]> {
  const rawLabelId = await ensureLabelId(config.labels.raw);
  // Ensure processed label also exists (we need its id later).
  await ensureLabelId(config.labels.processed);

  const query = `label:${config.labels.raw} is:unread newer_than:1d`;
  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 50,
  });

  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  const messages: RawMessage[] = [];

  for (const id of ids) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const msg = parseFullMessage(full.data);
    if (msg) messages.push(msg);
  }

  return messages;
}

function parseFullMessage(data: gmail_v1.Schema$Message): RawMessage | null {
  if (!data.id || !data.payload) return null;

  const headers = data.payload.headers ?? [];
  const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
  const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
  const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value;
  const receivedAt = date ? new Date(date) : new Date();

  // Walk MIME tree, prefer text/html.
  const html = findPart(data.payload, "text/html");
  const plain = findPart(data.payload, "text/plain");
  const chosen = html ?? plain;
  if (!chosen) return null;

  const body = decodeBase64Url(chosen.body?.data ?? "");
  return {
    id: data.id,
    subject,
    from,
    receivedAt,
    body,
    bodyType: html ? "text/html" : "text/plain",
  };
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string,
): gmail_v1.Schema$MessagePart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodeBase64Url(data: string): string {
  if (!data) return "";
  const normal = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normal, "base64").toString("utf8");
}

/** Mark message as read, remove raw label, add processed label. */
export async function markMessageProcessed(messageId: string): Promise<void> {
  const rawLabelId = await ensureLabelId(config.labels.raw);
  const processedLabelId = await ensureLabelId(config.labels.processed);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [processedLabelId],
      removeLabelIds: [rawLabelId, "UNREAD"],
    },
  });
}

/** Send an HTML email from the configured user to the configured recipient. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  htmlBody: string;
}): Promise<void> {
  const { to, subject, htmlBody } = opts;
  const from = config.gmail.user;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeRfc2047(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
  ].join("\r\n");

  const bodyB64 = Buffer.from(htmlBody, "utf8").toString("base64");
  const raw = Buffer.from(`${headers}\r\n\r\n${bodyB64}`, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

/** Encode subject for non-ASCII chars (TLDR sometimes uses emoji). */
function encodeRfc2047(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
