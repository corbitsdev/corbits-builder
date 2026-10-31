// Local development only: boots the vercel-labs/emulate Google emulator on
// loopback with a seeded user and OAuth client, so the hub's Google sign-in
// flow runs without real GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET credentials.
// Emulated sign-in is a development convenience, not a production identity source.
import { createServer, serve } from "@emulators/core";
import googlePlugin, { seedFromConfig } from "@emulators/google";

const port = Number(process.env["GOOGLE_EMULATE_PORT"] ?? 59099);
const email = process.env["GOOGLE_EMULATE_USER_EMAIL"] ?? "dev@example.com";
const name = process.env["GOOGLE_EMULATE_USER_NAME"] ?? "Dev User";
// The hub's better-auth callback URL. With the default dev boot (base URL
// http://localhost:8000) this already matches; override for another origin.
const redirectUris = (
  process.env["GOOGLE_EMULATE_REDIRECT_URIS"] ??
  "http://localhost:8000/api/auth/callback/google"
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const { app, store, baseUrl } = createServer(googlePlugin, { port });
seedFromConfig(store, baseUrl, {
  users: [{ email, name, email_verified: true }],
  oauth_clients: [
    {
      client_id:
        process.env["GOOGLE_CLIENT_ID"] ??
        "corbits-builder-dev.apps.googleusercontent.com",
      client_secret:
        process.env["GOOGLE_CLIENT_SECRET"] ??
        "GOCSPX-dev-emulate-not-a-secret",
      name: "Builder (local dev)",
      redirect_uris: redirectUris,
    },
  ],
});

const server = serve({ fetch: app.fetch, port });
server.on("listening", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Google emulator listening on ${url}`);
  console.log(`Seeded user: ${email}`);
  console.log(`Start the hub with GOOGLE_EMULATE_URL=${url}`);
});
