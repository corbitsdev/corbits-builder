import { type } from "arktype";
import { ProjectId } from "./project.ts";
import { Preferences } from "./preferences.ts";
import { ModelChoice, StoredModelChoice } from "./models.ts";

const version = type("number.integer >= 0").atMost(Number.MAX_SAFE_INTEGER);
export const ProviderNames = type("string > 0")
  .atMostLength(200)
  .array()
  .atMostLength(100)
  .or("null");
export type ProviderNames = typeof ProviderNames.infer;
export const PreferencesField = type({
  "+": "reject",
  value: Preferences.or("null"),
  version,
});
export const ModelsField = type({
  "+": "reject",
  value: StoredModelChoice.or("null"),
  version,
});
export const SettingsFields = type({
  "+": "reject",
  providerNames: { "+": "reject", value: ProviderNames, version },
  title: { "+": "reject", value: "string | null", version },
  "preferences?": PreferencesField,
  "models?": ModelsField,
});
export type SettingsFields = typeof SettingsFields.infer;
export const SettingsSave = type({
  "+": "reject",
  command: "'save_settings'",
  idempotencyKey: ProjectId,
  fields: type({
    "+": "reject",
    "providerNames?": {
      "+": "reject",
      value: ProviderNames,
      baseVersion: version,
    },
    "title?": {
      "+": "reject",
      value: type("string > 0").atMostLength(2000),
      baseVersion: version,
    },
    "preferences?": { "+": "reject", value: Preferences, baseVersion: version },
    "models?": { "+": "reject", value: ModelChoice, baseVersion: version },
  }),
});
export type SettingsSave = typeof SettingsSave.infer;
export const ProviderAvailability = type.or(
  { "+": "reject", state: "'configured'" },
  {
    "+": "reject",
    state: "'unconfigured'",
    requiredOperatorSetup: "string > 0",
  },
  { "+": "reject", state: "'unavailable'", detail: "string > 0" },
  { "+": "reject", state: "'unsupported'" },
);
export type ProviderAvailability = typeof ProviderAvailability.infer;
export const SettingsRecord = type({
  "+": "reject",
  scope: "'tenant' | 'project' | 'personal'",
  "projectId?": ProjectId,
  fields: SettingsFields,
});
export type SettingsRecord = typeof SettingsRecord.infer;
const SettingsFieldName = type(
  "'providerNames' | 'title' | 'preferences' | 'models'",
);
const settingValue = ProviderNames.or("string").or(Preferences).or(ModelChoice);
export const SettingsConflict = type({
  "+": "reject",
  field: SettingsFieldName,
  baseVersion: version,
  currentVersion: version,
  requestedValue: settingValue,
  currentValue: settingValue,
});
export type SettingsConflict = typeof SettingsConflict.infer;
export const SettingsReceipt = type({
  "+": "reject",
  record: SettingsRecord,
  savedFields: SettingsFieldName.array(),
  conflicts: SettingsConflict.array(),
});
export type SettingsReceipt = typeof SettingsReceipt.infer;
export const SettingsProviders = type({
  "+": "reject",
  providers: type({
    "+": "reject",
    id: "string > 0",
    name: "string > 0",
    // Omitted for a custom endpoint, which is probed only on demand.
    "availability?": ProviderAvailability,
    secrets: { "+": "reject", credential: { "+": "reject", set: "boolean" } },
  }).array(),
});
export type SettingsProviders = typeof SettingsProviders.infer;
// Each credential name the installed plugins declare: what it is, the origin it is sent to and how,
// and the plugins that declare it, by label. No key is in it.
// An API key names the origin it is sent to, and has signIn when the person may sign in at the
// provider to get it. A server key names no origin, because the server's address is saved with the
// key. It has provisioned when the hub makes it for a server a plugin rents.
const PluginCredential = type({
  "+": "reject",
  name: "string > 0",
  about: "string > 0",
  origin: "string > 0",
  sends: type("'bearer'").or({
    "+": "reject",
    header: "string > 0",
    "prefix?": "string > 0",
  }),
  "signIn?": "true",
  plugins: type("string > 0").array(),
}).or({
  "+": "reject",
  name: "string > 0",
  about: "string > 0",
  sends: "'ssh'",
  "provisioned?": "true",
  plugins: type("string > 0").array(),
});
export const PluginCredentials = type({
  "+": "reject",
  credentials: PluginCredential.array(),
});
export type PluginCredentials = typeof PluginCredentials.infer;
// The address a person typed for a server they rent: an IP address or host name, and the SSH port
// when it is not 22.
export const ServerAddress = type({
  "+": "reject",
  host: "string > 0",
  "port?": "1 <= number.integer <= 65535",
});
export type ServerAddress = typeof ServerAddress.infer;
// SSH's default port, which a server's address leaves out when the server uses it.
export const SSH_PORT = 22;
/**
 * How a server is named to the person, from the ssh origin it is pinned to: its address, with the
 * port only when it is not SSH's, as they would type it.
 */
export function serverLabel(origin: string): string {
  const url = new URL(origin);
  return url.port === "" || Number(url.port) === SSH_PORT
    ? url.hostname
    : url.host;
}
// A host key's fingerprint as Interchange's ssh provider stores it in a server key's secret.
export const SshHostKeyFingerprint = type(/^SHA256:[A-Za-z0-9+/]{43}$/);
// A server key the hub made for a project: the public key to put on the server, the server's name
// at the provider that rents it, its state, and the server's address once proved. The state is
// issued until a sign-in with the key proves a server, then bound, and lost if the key is revoked.
export const ServerKeyState = type({
  "+": "reject",
  publicKey: "string > 0",
  label: "string > 0",
  state: "'issued' | 'bound' | 'lost'",
  "address?": "string > 0",
});
export type ServerKeyState = typeof ServerKeyState.infer;
// A server key as a person sees it. A server they connect themselves has no label.
export const PersonServerKeyState = ServerKeyState.omit("label");
export type PersonServerKeyState = typeof PersonServerKeyState.infer;
// The server to prove an issued key on: its IP address and the fingerprint of the host key it must
// present. Only a hub set to reach private addresses accepts a port other than 22, for a server on
// a developer's machine.
export const ServerKeyBind = ServerAddress.merge({
  hostKey: SshHostKeyFingerprint,
});
export type ServerKeyBind = typeof ServerKeyBind.infer;
// Whether a revoke removed a key the calling plugin made; a key someone else made is left alone.
export const ServerKeyRevoked = type({ "+": "reject", revoked: "boolean" });
export type ServerKeyRevoked = typeof ServerKeyRevoked.infer;
// Why the hub would not issue, prove or keep a server key. server_key_taken: a person or another
// plugin made or connected a key with that name. server_unreachable, server_refused_key and
// server_host_key_mismatch mean the server does not yet match the bind, so a later try may succeed.
export const ServerKeyRefusalCode = type(
  "'server_key_taken' | 'server_key_not_issued' | 'server_key_bound_elsewhere' | 'invalid_bind' | 'invalid_address' | 'address_refused' | 'server_unreachable' | 'server_refused_key' | 'server_host_key_mismatch'",
);
export type ServerKeyRefusalCode = typeof ServerKeyRefusalCode.infer;
export const ServerKeyRefusal = type({
  "+": "reject",
  code: ServerKeyRefusalCode,
});
export type ServerKeyRefusal = typeof ServerKeyRefusal.infer;
// A person's request for a key to connect their own server. The hub returns the key they were given
// and have not connected yet, unless fresh asks for a new one.
export const ServerKeyIssue = type({
  "+": "reject",
  "fresh?": "boolean",
});
export type ServerKeyIssue = typeof ServerKeyIssue.infer;
// Why the hub would not give a person a key or connect their server. Besides a run's refusals: no
// installed plugin declares the name as a server key a person connects, or the tenant belongs to
// no project.
export const PersonServerKeyRefusalCode = ServerKeyRefusalCode.or(
  "'invalid_issue' | 'server_key_unknown' | 'server_key_project_only'",
);
export type PersonServerKeyRefusalCode =
  typeof PersonServerKeyRefusalCode.infer;
export const PersonServerKeyRefusal = type({
  "+": "reject",
  code: PersonServerKeyRefusalCode,
});
export type PersonServerKeyRefusal = typeof PersonServerKeyRefusal.infer;

// Starts a sign-in at a plugin's provider from the credential name alone. The installed plugin that
// declares the credential says where the person signs in and what the hub asks for there.
export const PluginSignInStart = type({
  "+": "reject",
  credential: "string > 0",
});
export type PluginSignInStart = typeof PluginSignInStart.infer;
// The sign-in the hub started: the id to track it by, and the provider URL to open. The URL
// contains none of the hub's secrets.
export const PluginSignInStarted = type({
  "+": "reject",
  id: "string > 0",
  url: "string > 0",
});
export type PluginSignInStarted = typeof PluginSignInStarted.infer;
// Why a sign-in did not save a credential: the provider refused or failed to give a token, the
// browser that came back was not signed in to Builder as the person who started it, the sign-in
// took too long, or a newer one for the same credential replaced it.
export const PluginSignInFailure = type(
  "'sign_in_refused' | 'sign_in_failed' | 'sign_in_other_session' | 'sign_in_expired' | 'sign_in_replaced'",
);
export type PluginSignInFailure = typeof PluginSignInFailure.infer;
export const PluginSignInState = type({
  "+": "reject",
  status: "'pending' | 'done' | 'cancelled'",
}).or({ "+": "reject", status: "'failed'", code: PluginSignInFailure });
export type PluginSignInState = typeof PluginSignInState.infer;
// Why the hub would not start a sign-in or disconnect one: no installed plugin signs in for that
// name, a sign-in is saved for one project only, the provider would not register the hub, or the
// tenant has no signed-in credential of that name.
export const PluginSignInRefusalCode = type(
  "'invalid_sign_in' | 'sign_in_unknown' | 'sign_in_project_only' | 'sign_in_unregistered' | 'sign_in_not_found'",
);
export type PluginSignInRefusalCode = typeof PluginSignInRefusalCode.infer;
export const PluginSignInRefusal = type({
  "+": "reject",
  code: PluginSignInRefusalCode,
});
export type PluginSignInRefusal = typeof PluginSignInRefusal.infer;
// Builder no longer has the disconnected credential. The provider may still have the grant when the
// plugin declares no revoke URL or the provider did not confirm the revoke, so the person is told
// to remove it there.
export const PluginSignInDisconnected = type({
  "+": "reject",
  code: "'disconnected' | 'provider_may_hold_grant'",
});
export type PluginSignInDisconnected = typeof PluginSignInDisconnected.infer;
