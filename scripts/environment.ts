import { list, port, reader } from "@corbits-builder/environment";
import { type } from "arktype";

/** `bun run auth:emulate`: the local Google emulator, its seeded user and OAuth client. */
export const readGoogleEmulatorEnvironment = reader(
  type({
    "+": "delete",
    GOOGLE_EMULATE_PORT: port.default("59099"),
    GOOGLE_EMULATE_USER_EMAIL: "string = 'dev@example.com'",
    GOOGLE_EMULATE_USER_NAME: "string = 'Dev User'",
    // The hub's better-auth callback URL. With the default dev boot (base URL
    // http://localhost:8000) this already matches; override for another origin.
    GOOGLE_EMULATE_REDIRECT_URIS: list.default(
      "http://localhost:8000/api/auth/callback/google",
    ),
    GOOGLE_CLIENT_ID:
      "string = 'corbits-builder-dev.apps.googleusercontent.com'",
    GOOGLE_CLIENT_SECRET: "string = 'GOCSPX-dev-emulate-not-a-secret'",
  }),
);

/**
 * `bun run dev:stop`: the ports a shell sets for `bun run dev`. Like `bun run dev`, it skips a
 * value that is not a port and uses the env files' value instead, so these are read as plain
 * strings.
 */
export const readDevStopEnvironment = reader(
  type({ "+": "delete", "PORT?": "string", "UI_PORT?": "string" }),
);
