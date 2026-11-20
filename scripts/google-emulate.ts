// Local development only: boots the vercel-labs/emulate Google emulator on
// loopback with a seeded user and OAuth client, so the hub's Google sign-in
// flow runs without real GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET credentials.
// Emulated sign-in is a development convenience, not a production identity source.
import { createServer, serve } from "@emulators/core";
import googlePlugin, { seedFromConfig } from "@emulators/google";
import { readGoogleEmulatorEnvironment } from "./environment.ts";

const env = readGoogleEmulatorEnvironment();
const port = env.GOOGLE_EMULATE_PORT;

const { app, store, baseUrl } = createServer(googlePlugin, { port });
seedFromConfig(store, baseUrl, {
  users: [
    {
      email: env.GOOGLE_EMULATE_USER_EMAIL,
      name: env.GOOGLE_EMULATE_USER_NAME,
      email_verified: true,
    },
  ],
  oauth_clients: [
    {
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      name: "Builder (local dev)",
      redirect_uris: env.GOOGLE_EMULATE_REDIRECT_URIS,
    },
  ],
});

const server = serve({ fetch: app.fetch, port });
server.on("listening", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Google emulator listening on ${url}`);
  console.log(`Seeded user: ${env.GOOGLE_EMULATE_USER_EMAIL}`);
  console.log(`Start the hub with GOOGLE_EMULATE_URL=${url}`);
});
