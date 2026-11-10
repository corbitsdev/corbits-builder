/**
 * What the Add provider dialog does: pick an API-key provider, paste its key, test it with one
 * real model-list call, and save only a key that passes. A custom endpoint is added from the same
 * dialog. Keys live in form state until they are handed over.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ModelProvider } from "@corbits-builder/schemas/models";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { setCredential } from "../../api/credentials.ts";
import type {
  AddProviderDialogViewProps,
  AddProviderStep,
} from "./add-provider-dialog.view.tsx";
import { useCustomProviderDraft } from "./custom-providers.model.ts";
import { message, NO_PROVIDERS, useModelCatalog } from "./model-catalog.ts";

const copy = wording.providers;

// The picker's tile for a person's own endpoint; no catalog provider has this id.
const CUSTOM_ENDPOINT = "custom-endpoint";

export type AddProviderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
  providerId?: string | undefined;
};

export function useAddProviderDialog({
  open,
  onOpenChange,
  onConnected,
  providerId,
}: AddProviderDialogProps): AddProviderDialogViewProps {
  const catalog = useModelCatalog();
  const queryClient = useQueryClient();
  const providers = (catalog.data?.providers ?? NO_PROVIDERS).filter(
    (provider) => provider.kind === "api_key",
  );
  const customApis = catalog.data?.customApis;
  const apis = customApis !== undefined ? customApis : [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const customDraft = useCustomProviderDraft(apis);
  const [busy, setBusy] = useState(false);
  const custom = providerId === undefined && chosenId === CUSTOM_ENDPOINT;
  const chosen: ModelProvider | undefined =
    providers.find((provider) => provider.id === (providerId ?? chosenId)) ??
    providers[0];
  const keyReady = chosen !== undefined && secret.trim().length > 0;
  const ready = custom ? customDraft.ready : keyReady;
  const picker = [
    ...providers,
    ...(providerId === undefined && apis.length > 0
      ? [
          {
            id: CUSTOM_ENDPOINT,
            label: copy.custom.tile,
            hint: copy.custom.tileHint,
          },
        ]
      : []),
  ];

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setSecret("");
      customDraft.reset();
    }
    onOpenChange(next);
  };

  const saved = async (label: string) => {
    setSecret("");
    customDraft.reset();
    toast.success(copy.saved(label));
    await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
    onConnected();
    onOpenChange(false);
  };

  const testAndSave = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (custom) {
        await customDraft.save();
        await saved(customDraft.name);
        return;
      }
      if (!keyReady) return;
      const tenantId = await workspaceTenantId();
      const { status } = await productClient().testProvider(tenantId, {
        plugin: chosen.plugin,
        baseURL: chosen.baseURL,
        secret: secret.trim(),
      });
      if (status !== "connected") {
        toast.error(copy.failed[status]);
        return;
      }
      await setCredential({
        plugin: chosen.plugin,
        secret: secret.trim(),
        baseURL: chosen.baseURL,
        label: chosen.label,
      });
      await saved(chosen.label);
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setBusy(false);
    }
  };

  let step: AddProviderStep;
  if (custom)
    step = {
      kind: "endpoint",
      form: customDraft.form,
      onBack: () => setChosenId(null),
    };
  else if (providerId)
    step = { kind: "key", provider: chosen ? chosen.label : null };
  else
    step = {
      kind: "pick",
      choices: picker,
      chosenId: chosen?.id,
      onChoose: setChosenId,
    };

  return {
    open,
    onOpenChange: close,
    fault: catalog.error ? message(catalog.error) : null,
    step,
    apiKey: secret,
    onApiKeyChange: setSecret,
    busy,
    ready,
    onSubmit: () => void testAndSave(),
  };
}
