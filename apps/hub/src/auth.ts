import { schema, type DB } from "@intx/db";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import {
  bearer,
  deviceAuthorization,
  genericOAuth,
  magicLink as magicLinkPlugin,
} from "better-auth/plugins";
import { and, eq, lt, ne } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const DEVICE_CLIENT_ID = "corbits-builder-cli";
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const VERIFICATION_RESEND_MS = 60_000;

export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
});

// Provenance belongs to the real session, not to a caller-controlled HTTP
// header: a device must not become interactive by replaying its token as a cookie.
export const deviceSession = pgTable("device_session", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => schema.session.id, { onDelete: "cascade" }),
});

export type HubAuthConfig = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  google?: { clientId: string; clientSecret: string; emulateBaseUrl?: string };
  allowedEmails?: string[];
  /** Where a person approves a device sign-in; unset leaves the device flow off. */
  device?: { verificationUri: string };
  verifyEmail?: (to: string, link: string) => Promise<void>;
  resetPassword?: (to: string, link: string) => Promise<void>;
  magicLink?: (to: string, link: string) => Promise<void>;
  onUserCreated?: (userId: string) => Promise<void>;
};

export type AuthMethods = {
  google: boolean;
  emailPassword: boolean;
  magicLink: boolean;
  passwordReset: boolean;
  verificationEmail: boolean;
};

export function authMethods(
  config: { google: boolean; allowedEmails?: string[] | undefined },
  sendsEmail: boolean,
): AuthMethods {
  return {
    google: config.google,
    emailPassword: config.allowedEmails === undefined || sendsEmail,
    magicLink: sendsEmail,
    passwordReset: sendsEmail,
    verificationEmail: sendsEmail,
  };
}

/** Entries are exact addresses or `@domain`. */
export function isEmailAllowed(
  email: string,
  allowedEmails: readonly string[],
): boolean {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@"));
  return allowedEmails.includes(address) || allowedEmails.includes(domain);
}

type AuthMiddlewareContext = Parameters<
  Parameters<typeof createAuthMiddleware>[0]
>[0];

async function stripSetAuthToken(ctx: AuthMiddlewareContext) {
  const headers = ctx.context.responseHeaders;
  if (!headers?.has("set-auth-token")) return;
  headers.delete("set-auth-token");
  const exposed = (headers.get("access-control-expose-headers") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(
      (name) => name.length > 0 && name.toLowerCase() !== "set-auth-token",
    );
  if (exposed.length > 0)
    headers.set("access-control-expose-headers", exposed.join(", "));
  else headers.delete("access-control-expose-headers");
}

const withoutSetAuthToken: BetterAuthPlugin = {
  id: "without-set-auth-token",
  hooks: {
    after: [
      { matcher: () => true, handler: createAuthMiddleware(stripSetAuthToken) },
    ],
  },
};

function isDeviceToken(body: unknown): body is { access_token: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "access_token" in body &&
    typeof body.access_token === "string"
  );
}

export async function isDeviceSession(
  db: DB["db"],
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ sessionId: deviceSession.sessionId })
    .from(deviceSession)
    .where(eq(deviceSession.sessionId, sessionId))
    .limit(1);
  return rows.length === 1;
}

// Client identity the local emulator's seeded OAuth client recognizes when the
// operator does not pin their own. These are not secrets: the emulator skips
// client-secret validation, and they never leave loopback dev boots.
export const GOOGLE_EMULATE_DEFAULT_CLIENT = {
  clientId: "corbits-builder-dev.apps.googleusercontent.com",
  clientSecret: "GOCSPX-dev-emulate-not-a-secret",
} as const;

export function createHubAuth(db: DB["db"], config: HubAuthConfig) {
  const {
    allowedEmails,
    google,
    verifyEmail,
    resetPassword,
    magicLink,
    onUserCreated,
  } = config;
  const sendsEmail =
    verifyEmail !== undefined &&
    resetPassword !== undefined &&
    magicLink !== undefined;

  // When the hub sends verification email, an unverified allowed address may sign in and is held at the verify screen.
  function requireAllowed(
    user: { email: string; emailVerified: boolean } | null,
  ) {
    if (allowedEmails === undefined) return;
    if (
      user === null ||
      (!user.emailVerified && !sendsEmail) ||
      !isEmailAllowed(user.email, allowedEmails)
    ) {
      throw new APIError("FORBIDDEN", {
        message: "This email is not allowed to sign in.",
      });
    }
  }

  // An invite or a not-yet-verified sign-up creates its user unverified; the
  // session hook holds them to the full allowlist rule once they prove the address.
  async function requireAllowedNewUser(user: { email: string }) {
    if (
      allowedEmails !== undefined &&
      !isEmailAllowed(user.email, allowedEmails)
    ) {
      throw new APIError("FORBIDDEN", {
        message: "This email is not allowed to sign in.",
      });
    }
  }

  // Codes nobody redeemed stay behind; each new request clears the expired ones.
  async function deleteExpiredDeviceCodes() {
    await db.delete(deviceCode).where(lt(deviceCode.expiresAt, new Date()));
  }

  // better-auth keys its limits on a forwarded IP it cannot resolve behind a proxy, so resends are limited per account.
  const recentResends = new Set<string>();
  async function limitVerificationResend(ctx: AuthMiddlewareContext) {
    if (
      ctx.path !== "/send-verification-email" ||
      typeof ctx.body?.email !== "string"
    )
      return;
    const session = await getSessionFromCtx(ctx);
    const key = session
      ? `user:${session.user.id}`
      : `email:${ctx.body.email.toLowerCase()}`;
    if (recentResends.has(key))
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "Wait a minute before asking for another link.",
      });
    recentResends.add(key);
    setTimeout(() => recentResends.delete(key), VERIFICATION_RESEND_MS).unref();
  }

  // The device token is a raw session token: record its provenance so protected
  // human surfaces can refuse it, then sign it like the session cookie so
  // bearer() accepts only signed tokens.
  async function finalizeDeviceToken(ctx: AuthMiddlewareContext) {
    const body = ctx.context.returned;
    if (ctx.path !== "/device/token" || !isDeviceToken(body)) return;
    const rows = await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.token, body.access_token))
      .limit(1);
    // Fail closed: if the backing session cannot be found or provenance cannot
    // be persisted, no usable token may leave the hub — otherwise a device
    // credential without recorded origin could pass as an ordinary session.
    if (rows.length !== 1)
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Device sign-in could not resolve its session.",
      });
    await db
      .insert(deviceSession)
      .values({ sessionId: rows[0]!.id })
      .onConflictDoNothing();
    if (!(await isDeviceSession(db, rows[0]!.id)))
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Device sign-in could not record token provenance.",
      });
    return ctx.json({
      ...body,
      access_token: `${body.access_token}.${await makeSignature(body.access_token, config.secret)}`,
    });
  }

  async function sendMagicLink({ email, url }: { email: string; url: string }) {
    if (!magicLink)
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Magic-link email is not configured.",
      });
    await magicLink(email, url);
  }

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    // The user id becomes the person's mail local part, and mail routing matches addresses exactly, so ids must already be lowercase.
    advanced: {
      database: { generateId: () => crypto.randomUUID().replaceAll("-", "") },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { ...schema, deviceCode },
    }),
    emailAndPassword: {
      enabled: authMethods(
        { google: google !== undefined, allowedEmails },
        sendsEmail,
      ).emailPassword,
      ...(resetPassword && {
        revokeSessionsOnPasswordReset: true,
        async sendResetPassword({
          user,
          url,
        }: {
          user: { email: string };
          url: string;
        }) {
          await resetPassword(user.email, url);
        },
        // The reset link proves the mailbox, like a magic link: verify the address and drop provider links nobody proved.
        async onPasswordReset({
          user,
        }: {
          user: { id: string; emailVerified: boolean };
        }) {
          if (user.emailVerified) return;
          await db
            .delete(schema.account)
            .where(
              and(
                eq(schema.account.userId, user.id),
                ne(schema.account.providerId, "credential"),
              ),
            );
          await db
            .update(schema.user)
            .set({ emailVerified: true, updatedAt: new Date() })
            .where(eq(schema.user.id, user.id));
        },
      }),
    },
    ...(verifyEmail && {
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: false,
        expiresIn: 3600,
        async sendVerificationEmail({
          user,
          url,
        }: {
          user: { email: string };
          url: string;
        }) {
          await verifyEmail(user.email, url);
        },
      },
    }),
    ...(google && !google.emulateBaseUrl
      ? { socialProviders: { google } }
      : {}),
    // better-auth keys its limit by client IP and path, and an allowed request restarts the
    // window, so every tab on one machine polling the session shares a bucket that never drains.
    // Reading or ending your own session guesses no credential; sign-in and sign-up keep the
    // library's own limits.
    rateLimit: {
      enabled: true,
      customRules: {
        "/device/code": { window: 60, max: 5 },
        "/get-session": false,
        "/sign-out": false,
      },
    },
    plugins: [
      bearer({ requireSignature: true }),
      withoutSetAuthToken,
      ...(config.device
        ? [
            deviceAuthorization({
              validateClient: (clientId) => clientId === DEVICE_CLIENT_ID,
              verificationUri: config.device.verificationUri,
              onDeviceAuthRequest: deleteExpiredDeviceCodes,
            }),
          ]
        : []),
      ...(magicLink
        ? [
            magicLinkPlugin({
              expiresIn: MAGIC_LINK_TTL_SECONDS,
              storeToken: "hashed",
              sendMagicLink,
            }),
          ]
        : []),
      // Development Google emulation: a generic OAuth provider registered under
      // the built-in "google" id shadows it (better-auth concatenates generic
      // providers ahead of the registry), so the existing sign-in surface,
      // provider id and callback route all keep working while every endpoint
      // stays on the loopback emulator. The built-in provider would hardcode
      // Google's token endpoint, which cannot be pointed at an emulator.
      ...(google?.emulateBaseUrl
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "google",
                  name: "Google",
                  clientId: google.clientId,
                  clientSecret: google.clientSecret,
                  authorizationUrl: `${google.emulateBaseUrl}/o/oauth2/v2/auth`,
                  tokenUrl: `${google.emulateBaseUrl}/oauth2/token`,
                  userInfoUrl: `${google.emulateBaseUrl}/oauth2/v2/userinfo`,
                  scopes: ["openid", "email", "profile"],
                  redirectURI: `${config.baseURL}/api/auth/callback/google`,
                  pkce: true,
                },
              ],
            }),
          ]
        : []),
    ],
    hooks: {
      before: createAuthMiddleware(limitVerificationResend),
      after: createAuthMiddleware(finalizeDeviceToken),
    },
    databaseHooks: {
      user: {
        create: {
          before: requireAllowedNewUser,
          ...(onUserCreated
            ? { after: (user: { id: string }) => onUserCreated(user.id) }
            : {}),
        },
      },
      // Also checked per session, so accounts that predate the allowlist are held to it.
      session: {
        create: {
          async before(session, ctx) {
            if (allowedEmails === undefined) return;
            requireAllowed(
              ctx === null
                ? null
                : await ctx.context.internalAdapter.findUserById(
                    session.userId,
                  ),
            );
          },
        },
      },
    },
  });
}
