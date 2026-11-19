import { type } from "arktype";
import manifest from "../package.json";

// The documents a person accepts before Builder creates a temporary account for them. The request
// that creates it names them.
export const TERMS_OF_SERVICE = "https://www.cloudflare.com/terms/";
export const PRIVACY_POLICY = "https://www.cloudflare.com/privacypolicy/";

// The handle a release on Cloudflare is recorded under.
export const TARGET = "cloudflare";

// The key the person saves for their own Cloudflare account, as the manifest declares it.
export const CREDENTIAL =
  "cloudflare" satisfies keyof typeof manifest.builder.credentials;

// The project value for the person's acceptance of Cloudflare's terms for one temporary account:
// the ISO time they accepted. Cleared once that account is created.
export const TERMS = "cloudflare.terms";

// How long an acceptance lasts. One given long ago does not show the person wants to publish today.
export const TERMS_STAND_MS = 60 * 60_000;

// The project value that records what a publish created on Cloudflare, so the next publish updates
// it.
export const SITE = "cloudflare.site";

// What a publish created: the account, the worker's name, its database if any, whether the account
// is temporary and, if so, when Cloudflare removes it unless the person keeps it. Only ids and a
// time, none of them secret.

export const CloudflareSite = type({
  "+": "reject",
  account: "string > 0",
  script: "string > 0",
  "database?": "string > 0",
  temporary: "boolean",
  "keepUntil?": "string.date.iso",
});
export type CloudflareSite = typeof CloudflareSite.infer;
