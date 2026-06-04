// scripts/bootstrap-gmail-auth.ts
// Run ONCE on your laptop to mint a refresh token.
//
// Usage:
//   bun run scripts/bootstrap-gmail-auth.ts ./oauth-client.json
//
// Requirements:
//   - You've created an OAuth client in Google Cloud Console
//     (type: "Desktop app") and downloaded the JSON.
//   - The Gmail API is enabled in that project.

import { google } from "googleapis";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { URL } from "node:url";

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const clientPath = process.argv[2];
if (!clientPath) {
  console.error(
    "Usage: bun run scripts/bootstrap-gmail-auth.ts <path-to-oauth-client.json>",
  );
  process.exit(1);
}

const clientJson = JSON.parse(readFileSync(clientPath, "utf8"));
const { client_id, client_secret } = clientJson.installed ?? clientJson.web ?? {};

if (!client_id || !client_secret) {
  console.error(
    "Could not find client_id/client_secret in the JSON. Make sure you downloaded a Desktop OAuth client.",
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force refresh token issuance
  scope: SCOPES,
});

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for callback on", REDIRECT_URI, "...\n");

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("No code in callback");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2>✓ Done. You can close this tab and return to your terminal.</h2>",
    );

    console.log("\n=== COPY THE FOLLOWING INTO YOUR .env ===\n");
    console.log(`GMAIL_CLIENT_ID=${client_id}`);
    console.log(`GMAIL_CLIENT_SECRET=${client_secret}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n=========================================\n");

    if (!tokens.refresh_token) {
      console.warn(
        "⚠️  No refresh_token returned. This usually means you've already authorized this app.",
      );
      console.warn(
        "    Go to https://myaccount.google.com/permissions, revoke the app, and re-run this script.",
      );
    }

    server.close();
    process.exit(0);
  } catch (e) {
    console.error("Token exchange failed:", e);
    res.writeHead(500);
    res.end("Token exchange failed");
    server.close();
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT);
