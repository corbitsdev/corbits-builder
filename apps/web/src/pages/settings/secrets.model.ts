/**
 * What the Secrets tab does: reads the keys plugins saved in Interchange, in the workspace and in
 * each of its projects, through the person's own session; names the installed plugins that declare
 * each from the hub's `/settings/plugin-credentials`; and replaces or revokes a key there.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { credentialProvider } from "@corbits-builder/plugin";
import {
  heldCredentials,
  replaceCredential,
  revokeCredential,
} from "@corbits-builder/plugin-ui/credential-form";
import type { PluginCredentials } from "@corbits-builder/schemas/settings";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { message } from "./model-catalog.ts";
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
  credentials: readonly { id: string; name: string; status: string }[];
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
    tenants.map(async ({ tenant, project }) => ({
      tenant,
      project,
      credentials: await heldCredentials(tenant),
    })),
  );
  return { workspace, places, declared };
}

const declarationOf = (declared: readonly Declared[], credential: string) =>
  declared.find(({ name }) => credentialProvider(name) === credential);

function savedSecret(
  declared: readonly Declared[],
  credential: Place["credentials"][number],
): SavedSecret {
  const declaration = declarationOf(declared, credential.name);
  return {
    id: credential.id,
    label: declaration?.about ?? credential.name.slice(PREFIX.length),
    usedBy: declaration
      ? {
          plugins: declaration.plugins,
          host: new URL(declaration.origin).host,
        }
      : null,
  };
}

/** Each place's active plugin keys, the workspace's first, each named by the plugins that declare it. */
export function secretGroups(
  places: readonly Place[],
  declared: readonly Declared[],
): SecretGroup[] {
  return places.map((place) => ({
    id: place.tenant,
    project: place.project,
    secrets: place.credentials
      .filter(
        ({ name, status }) => name.startsWith(PREFIX) && status === "active",
      )
      .map((credential) => savedSecret(declared, credential)),
  }));
}

/** Where a listed key is held and the declaration it was saved for, if any plugin still makes one. */
function locate({ places, declared }: Secrets, id: string) {
  for (const place of places) {
    const credential = place.credentials.find((held) => held.id === id);
    if (credential)
      return {
        owner: place.tenant,
        declaration: declarationOf(declared, credential.name),
      };
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
      const { owner, declaration } = locate(data, id);
      // A key no installed plugin declares has no way to send it, so its row offers no replacement.
      if (!declaration) throw new Error(`secret_undeclared:${id}`);
      await replaceCredential(
        { owner, workspace: data.workspace },
        id,
        declaration.name,
        declaration,
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
      await revokeCredential(locate(secrets(), id).owner, id);
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
