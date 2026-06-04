// src/config.ts
// Validates env once at boot; fail loud on missing required vars.

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function optional(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : fallback;
}

export const config = {
  gmail: {
    clientId: required("GMAIL_CLIENT_ID"),
    clientSecret: required("GMAIL_CLIENT_SECRET"),
    refreshToken: required("GMAIL_REFRESH_TOKEN"),
    user: required("GMAIL_USER"),
  },
  openrouter: {
    apiKey: required("OPENROUTER_API_KEY"),
    model: optional("OPENROUTER_MODEL", "anthropic/claude-haiku-4.5"),
  },
  recipient: required("RECAP_RECIPIENT"),
  labels: {
    raw: optional("LABEL_RAW", "TLDR/raw"),
    processed: optional("LABEL_PROCESSED", "TLDR/processed"),
  },
  minItemsBeforeFailure: parseInt(
    optional("MIN_ITEMS_BEFORE_FAILURE", "5"),
    10,
  ),
  tz: optional("TZ", "Europe/Madrid"),
} as const;
