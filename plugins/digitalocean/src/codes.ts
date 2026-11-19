import type { Outcome as PluginOutcome } from "@corbits-builder/plugin/tools";

// Every way the create, status and remove tools can fail. The agents' codes skill explains each
// code.
export const CODES = [
  "no_choice",
  "not_agreed",
  "account_locked",
  "team_changed",
  "team_unknown",
  "price_changed",
  "size_unavailable",
  "key_lost",
  "key_taken",
  "too_many_tries",
  "create_refused",
  "server_slow",
  "server_gone",
  "not_removed_yet",
  "not_ours",
  "address_differs",
  "signed_out",
  "provider_refused",
  "provider_unavailable",
  "builder_unavailable",
] as const;
export type Code = (typeof CODES)[number];

// What a tool returns to the agent: ok, or one code and a few typed fields. DigitalOcean's text
// reaches the agent only as message, when the account or a refused create gives a reason, and as
// team names.
export type Outcome = PluginOutcome<Code>;
