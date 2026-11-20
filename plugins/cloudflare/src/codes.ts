import type { Outcome as PluginOutcome } from "@corbits-builder/plugin/tools";

// Every code a tool can fail with. The agent's codes skill explains each one.
export const CODES = [
  "not_publishable",
  "app_not_saved",
  "not_fitted",
  "app_changed",
  "install_failed",
  "build_failed",
  "build_timed_out",
  "too_large",
  "builder_busy",
  "builder_unavailable",
  "no_account_chosen",
  "key_refused",
  "several_accounts",
  "no_subdomain",
  "name_taken",
  "account_not_created",
  "database_not_created",
  "migration_failed",
  "migration_misnamed",
  "worker_refused",
  "not_answering_yet",
  "cloudflare_unavailable",
  "needs_own_account",
  "other_account",
  "not_published",
  "not_agreed",
] as const;
export type Code = (typeof CODES)[number];

// What a tool returns to the agent: ok, or one code and a few typed fields, never Cloudflare's
// messages. A step returns either its result or an Outcome.
export type Outcome = PluginOutcome<Code>;

/** Whether a step returned an Outcome instead of its result. */
export const isOutcome = (value: unknown): value is Outcome =>
  typeof value === "object" && value !== null && "ok" in value;
