/**
 * What the Secrets tab does: reads the keys plugins saved in Interchange, in the workspace and in
 * each of its projects, through the person's own session; names the installed plugins that declare
 * each from the hub's `/settings/plugin-credentials`; and replaces or revokes a key there. A key the
 * person signed in for is disconnected through the hub instead, which also revokes it at the
 * provider.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { credentialProvider } from "@corbits-builder/plugin";
import {
  heldCredentials,
  heldServers,
  replaceCredential,
  revokeCredential,
  type ApiKeySending,
} from "@corbits-builder/plugin-ui/credentials";
import type { PluginCredentials } from "@corbits-builder/schemas/settings";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { message } from "../model-catalog.ts";
import type {
  SavedSecret,
  SecretGroup,
  SecretsSectionViewProps,
} from "./secrets.view.tsx";

const copy = wording.secrets;

// Every plugin key is saved under a provider of this prefix, so other credentials stay out.
const PREFIX = credentialProvider("");

type Declared = PluginCredentials["credentials"][number];

/** The credentials one tenant holds: the workspace's, or one project's. */
export type Place = {
  tenant: string;
  /** The project's name; null for the workspace. */
  project: string | null;
  credentials: readonly {
    id: string;
    name: string;
    type: string;
    status: string;
    providerId: string;
    metadata?: Record<string, unknown> | null;
  }[];
  /** The address of each server this place has a key for, by the id of the key's provider. */
  servers: Readonly<Record<string, string>>;
};

type Secrets = {
  workspace: string;
  places: readonly Place[];
  declared: readonly Declared[];
};

async function readSecrets(): Promise<Secrets> {
  const workspace = await workspaceTenantId();
  const client = productClient();
  const [{ credentials: declared }, { projects }] = await Promise.all([
    client.pluginCredentials(workspace),
    client.projects(workspace, { status: "all" }),
  ]);
  const tenants = [
    { tenant: workspace, project: null },
    ...projects.map((row) => ({ tenant: row.tenantId, project: row.title })),
  ];
  const places = await Promise.all(
    tenants.map(async ({ tenant, project }) => {
      const [credentials, servers] = await Promise.all([
        heldCredentials(tenant),
        heldServers(tenant),
      ]);
      return { tenant, project, credentials, servers };
    }),
  );
  return { workspace, places, declared };
}

const declarationOf = (declared: readonly Declared[], credential: string) =>
  declared.find(({ name }) => credentialProvider(name) === credential);

// Where a saved key came from: typed or connected by the person, a sign-in at the provider, or made
// by Builder for a server a plugin rented.
function kindOf(
  declaration: Declared | undefined,
  credential: Place["credentials"][number],
): SavedSecret["kind"] {
  if (declaration?.sends === "ssh" && declaration.provisioned)
    return "provisioned";
  if (
    declaration?.sends !== "ssh" &&
    declaration?.signIn &&
    credential.type === "oauth_token"
  )
    return "signedIn";
  return "key";
}

// How a new key typed in place of a credential is sent. A key is replaceable only if this is known.
// Only a plugin's declaration says how an API key is sent. A server key is a pair made for one
// server, so it is revoked and connected again instead of retyped. A signed-in key is renewed by
// signing in again on its plugin's screen. Null when the key cannot be replaced.
function replacement(
  declaration: Declared | undefined,
  kind: SavedSecret["kind"],
): ApiKeySending | null {
  if (declaration === undefined || declaration.sends === "ssh") return null;
  if (kind !== "key") return null;
  return { origin: declaration.origin, sends: declaration.sends };
}

function savedSecret(
  declared: readonly Declared[],
  credential: Place["credentials"][number],
  servers: Place["servers"],
): SavedSecret {
  const declaration = declarationOf(declared, credential.name);
  const kind = kindOf(declaration, credential);
  const account = credential.metadata?.["account"];
  return {
    id: credential.id,
    label: declaration?.about ?? credential.name.slice(PREFIX.length),
    usedBy: declaration
      ? {
          plugins: declaration.plugins,
          // A server key is sent to the person's own server, whose address is saved with the key.
          host:
            declaration.sends === "ssh"
              ? (servers[credential.providerId] ?? null)
              : new URL(declaration.origin).host,
        }
      : null,
    replaceable: replacement(declaration, kind) !== null,
    kind,
    account:
      kind === "signedIn" && typeof account === "string" ? account : null,
    signedOut: credential.status !== "active",
  };
}

// A sign-in the provider stopped accepting stays listed, marked as such, until the person signs in
// again or disconnects it. Any other key that is no longer active is left out.
const listed = (
  declared: readonly Declared[],
  credential: Place["credentials"][number],
) =>
  credential.name.startsWith(PREFIX) &&
  (credential.status === "active" ||
    (credential.status === "error" &&
      kindOf(declarationOf(declared, credential.name), credential) ===
        "signedIn"));

/** Each place's plugin keys, the workspace's first, each named by the plugins that declare it. */
export function secretGroups(
  places: readonly Place[],
  declared: readonly Declared[],
): SecretGroup[] {
  return places.map((place) => ({
    id: place.tenant,
    project: place.project,
    secrets: place.credentials
      .filter((credential) => listed(declared, credential))
      .map((credential) => savedSecret(declared, credential, place.servers)),
  }));
}

/**
 * Where a listed key is saved, the declaration it was saved for if any plugin still makes one, and
 * where the key came from.
 */
function locate({ places, declared }: Secrets, id: string) {
  for (const place of places) {
    const credential = place.credentials.find((held) => held.id === id);
    if (credential) {
      const declaration = declarationOf(declared, credential.name);
      return {
        owner: place.tenant,
        declaration,
        kind: kindOf(declaration, credential),
      };
    }
  }
  throw new Error(`secret_unknown:${id}`);
}

export function useSecretsSection(): SecretsSectionViewProps {
  const queryClient = useQueryClient();
  const read = useQuery({
    queryKey: keys.secrets,
    queryFn: readSecrets,
    meta: { persist: false },
  });
  const [pending, setPending] = useState<string | null>(null);
  const [replacing, setReplacing] =
    useState<SecretsSectionViewProps["replacing"]>(null);

  // A row's actions show only once the read has data, so the read is there when one runs.
  const secrets = () => {
    if (read.data === undefined) throw new Error("secrets_unread");
    return read.data;
  };

  const replace = async (id: string, key: string) => {
    setPending(id);
    try {
      const data = secrets();
      const { owner, declaration, kind } = locate(data, id);
      const sending = replacement(declaration, kind);
      // Only a replaceable row offers a replacement.
      if (declaration === undefined || sending === null)
        throw new Error(`secret_not_replaceable:${id}`);
      await replaceCredential(
        { owner, workspace: data.workspace },
        id,
        declaration.name,
        sending,
        key,
      );
      setReplacing(null);
      await queryClient.invalidateQueries({ queryKey: keys.secrets });
    } catch (cause) {
      setReplacing({ id, refused: copy.refused(message(cause)) });
    } finally {
      setPending(null);
    }
  };

  const revoke = async (id: string) => {
    setPending(id);
    try {
      const { owner, declaration, kind } = locate(secrets(), id);
      if (kind === "signedIn" && declaration !== undefined) {
        const { code } = await productClient().disconnectPluginSignIn(
          owner,
          declaration.name,
        );
        if (code === "provider_may_hold_grant")
          toast.warning(copy.providerMayHold);
      } else await revokeCredential(owner, id);
      setReplacing((open) => (open?.id === id ? null : open));
      await queryClient.invalidateQueries({ queryKey: keys.secrets });
    } catch (cause) {
      toast.error(copy.notRevoked(message(cause)));
    } finally {
      setPending(null);
    }
  };

  return {
    loading: read.isPending,
    fault: read.error ? message(read.error) : null,
    groups:
      read.data === undefined
        ? []
        : secretGroups(read.data.places, read.data.declared),
    pending,
    replacing,
    onReplacing: (id) =>
      setReplacing(id === null ? null : { id, refused: null }),
    onReplace: (id, key) => void replace(id, key),
    onRevoke: (id) => void revoke(id),
  };
}
