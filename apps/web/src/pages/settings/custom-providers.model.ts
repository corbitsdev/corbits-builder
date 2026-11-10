/**
 * What a person's own endpoints do: one hook each for the connection form, an endpoint's row, the
 * models under it and the dialog that edits it.
 *
 * The connection is a name, the API it speaks, a base URL, and a key or Keyless. The hub keeps the
 * key on the base URL it was entered for, so a new API type, base URL or key is a new connection
 * and is tested before it is saved, like any other key; a keyless server is tested with no key at
 * all. The hub needs one model to add a provider, so the add dialog asks for the first; the rest
 * are managed under the row.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CustomApi,
  type CustomModel,
  type CustomProviderCreate,
  type ModelCatalog,
  type ModelProvider,
} from "@corbits-builder/schemas/models";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { message, useModelCatalog } from "./model-catalog.ts";
import type {
  CustomProviderFields,
  CustomProviderModelsViewProps,
  CustomProviderRowViewProps,
  EditCustomProviderDialogViewProps,
  EndpointFields,
  ModelFields,
  SaveState,
} from "./custom-providers.view.tsx";

const copy = wording.providers;

type CustomDraft = EndpointFields & { api: CustomApi; model: ModelFields };

type Apis = ModelCatalog["customApis"];

// A model listed under its provider; a fixed one is saved, so its id is no longer edited.
type ListedModel = ModelFields & { fixed: boolean };

const BLANK_MODEL: ModelFields = {
  id: "",
  label: "",
  contextWindow: "",
  maxOutputTokens: "",
};

const BLANK_DRAFT: CustomDraft = {
  name: "",
  api: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  keyless: false,
  model: BLANK_MODEL,
};

function keylessOf(provider: ModelProvider): boolean {
  return provider.connections.some((connection) => connection.keyless);
}

/** A custom provider whose plugin is an API this form can edit. */
export type EditableProvider = ModelProvider & { plugin: CustomApi };

const editable = (provider: ModelProvider): provider is EditableProvider =>
  CustomApi.allows(provider.plugin);

function draftOf(provider: EditableProvider): CustomDraft {
  return {
    name: provider.label,
    api: provider.plugin,
    baseUrl: provider.baseURL,
    apiKey: "",
    keyless: keylessOf(provider),
    model: BLANK_MODEL,
  };
}

function modelDraftOf(model: ModelProvider["models"][number]): ModelFields {
  const label = model.label;
  return {
    id: model.id,
    // An unnamed custom model drafts with an empty label; it shows by its id.
    label: label !== undefined ? label : "",
    contextWindow: "contextWindow" in model ? String(model.contextWindow) : "",
    maxOutputTokens:
      "maxOutputTokens" in model ? String(model.maxOutputTokens) : "",
  };
}

function tokens(value: string): number | null {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function duplicateIds(models: readonly ModelFields[]): boolean {
  const ids = models.map((model) => model.id.trim()).filter(Boolean);
  return new Set(ids).size !== ids.length;
}

/** The models drafted, once every id is set and distinct and each output cap is below its window. */
function parsedModels(models: readonly ModelFields[]): CustomModel[] | null {
  if (models.length === 0 || duplicateIds(models)) return null;
  const parsed: CustomModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    const label = model.label.trim();
    const contextWindow = tokens(model.contextWindow);
    const maxOutputTokens = tokens(model.maxOutputTokens);
    if (!id || !contextWindow || !maxOutputTokens) return null;
    if (maxOutputTokens >= contextWindow) return null;
    parsed.push({
      id,
      ...(label ? { label } : {}),
      contextWindow,
      maxOutputTokens,
    });
  }
  return parsed;
}

/** Whether saving makes a new connection: always when adding, else on a new API, URL or key. */
function reconnects(draft: CustomDraft, original?: ModelProvider): boolean {
  return (
    !original ||
    draft.api !== original.plugin ||
    draft.baseUrl.trim() !== original.baseURL ||
    draft.keyless !== keylessOf(original) ||
    draft.apiKey.trim().length > 0
  );
}

function endpointOf(draft: CustomDraft): CustomProviderCreate["connection"] {
  const endpoint = { api: draft.api, baseURL: draft.baseUrl.trim() };
  return draft.keyless
    ? { ...endpoint, keyless: true }
    : { ...endpoint, secret: draft.apiKey.trim() };
}

async function testConnection(draft: CustomDraft): Promise<void> {
  const { api, ...connection } = endpointOf(draft);
  const { status } = await productClient().testProvider(
    await workspaceTenantId(),
    { plugin: api, ...connection },
  );
  if (status !== "connected") throw new Error(copy.failed[status]);
}

/**
 * One custom provider's connection form: its fields, whether it can be submitted, whether
 * submitting tests a new connection first, and `save`, which throws a failed test's reason.
 */
export function useCustomProviderDraft(
  apis: Apis,
  original?: EditableProvider,
): {
  name: string;
  tests: boolean;
  ready: boolean;
  reset: () => void;
  form: CustomProviderFields;
  save: () => Promise<void>;
} {
  const [draft, setDraft] = useState(() =>
    original ? draftOf(original) : BLANK_DRAFT,
  );
  const tests = reconnects(draft, original);
  const keyed = draft.keyless || draft.apiKey.trim().length > 0;
  return {
    name: draft.name.trim(),
    tests,
    ready:
      draft.name.trim().length > 0 &&
      draft.baseUrl.trim().length > 0 &&
      (!tests || keyed) &&
      (original !== undefined || parsedModels([draft.model]) !== null),
    reset: () => setDraft(BLANK_DRAFT),
    form: {
      endpoint: draft,
      onEndpointChange: (endpoint) =>
        setDraft({ ...draft, ...endpoint, api: endpoint.api as CustomApi }),
      apis: apis.map((api) => ({
        ...api,
        path: copy.custom.apiPaths[api.id],
        tip: copy.custom.apiTips[api.id],
      })),
      keyAgain:
        original !== undefined &&
        (draft.api !== original.plugin ||
          draft.baseUrl.trim() !== original.baseURL),
      firstModel: original ? null : draft.model,
      onFirstModelChange: (model) => setDraft({ ...draft, model }),
    },
    save: async (): Promise<void> => {
      const models = parsedModels(
        original ? original.models.map(modelDraftOf) : [draft.model],
      );
      if (models === null) throw new Error(copy.custom.modelsUnreadable);
      if (tests) await testConnection(draft);
      const tenantId = await workspaceTenantId();
      const client = productClient();
      const name = draft.name.trim();
      if (!original) {
        await client.createCustomProvider(tenantId, {
          name,
          models,
          connection: endpointOf(draft),
        });
        return;
      }
      await client.updateCustomProvider(tenantId, original.id, {
        name,
        models,
        ...(tests ? { connection: endpointOf(draft) } : {}),
      });
    },
  };
}

/** A custom provider's row: what it shows, removing it, and which connection is being edited. */
export function useCustomProviderRow({
  provider,
  onChanged,
}: {
  provider: ModelProvider;
  onChanged: () => void;
}): {
  view: Omit<CustomProviderRowViewProps, "models" | "editor">;
  /** The provider whose connection the edit dialog is open on. */
  editing: EditableProvider | null;
  onEditorClose: () => void;
} {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const editableProvider = editable(provider) ? provider : null;
  const [removing, setRemoving] = useState(false);

  const remove = async () => {
    setRemoving(true);
    try {
      await productClient().removeCustomProvider(
        await workspaceTenantId(),
        provider.id,
      );
      toast.success(copy.custom.removed(provider.label));
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onChanged();
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setRemoving(false);
    }
  };

  return {
    view: {
      id: provider.id,
      name: provider.label,
      hint: provider.hint,
      modelCount: provider.models.length,
      editable: editableProvider !== null,
      removing,
      onEdit: () => setEditing(true),
      onRemove: () => void remove(),
    },
    editing: editing ? editableProvider : null,
    onEditorClose: () => setEditing(false),
  };
}

/** A custom provider's models, each edited in place and saved once the list is complete. */
export function useCustomProviderModels({
  provider,
  onChanged,
}: {
  provider: ModelProvider;
  onChanged: () => void;
}): CustomProviderModelsViewProps {
  const queryClient = useQueryClient();
  const [models, setModels] = useState<ListedModel[]>(() =>
    provider.models.map((model) => ({ ...modelDraftOf(model), fixed: true })),
  );
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const saved = useRef(JSON.stringify(parsedModels(models)));

  // Saves once the list is complete and differs from what the hub holds; a half-typed model waits.
  const commit = async (next: readonly ListedModel[]) => {
    const parsed = parsedModels(next);
    const snapshot = JSON.stringify(parsed);
    if (!parsed || snapshot === saved.current) return;
    setSaveState("saving");
    try {
      await productClient().updateCustomProvider(
        await workspaceTenantId(),
        provider.id,
        { name: provider.label, models: parsed },
      );
      saved.current = snapshot;
      setModels((current) =>
        current.map((model) => ({
          ...model,
          fixed: model.fixed || parsed.some(({ id }) => id === model.id.trim()),
        })),
      );
      setSaveState("saved");
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onChanged();
    } catch (cause) {
      setSaveState("failed");
      toast.error(message(cause));
    }
  };

  return {
    models,
    duplicateIds: duplicateIds(models),
    saveState,
    onModelChange: (index, next) =>
      setModels(
        models.map((entry, at) =>
          at === index ? { ...next, fixed: entry.fixed } : entry,
        ),
      ),
    onModelCommit: () => void commit(models),
    onRemoveModel: (index) => {
      const rest = models.filter((_, at) => at !== index);
      setModels(rest);
      void commit(rest);
    },
    onAddModel: () => setModels([...models, { ...BLANK_MODEL, fixed: false }]),
  };
}

/** The dialog that edits one custom provider's connection and saves it. */
export function useEditCustomProvider({
  provider,
  onClose,
  onSaved,
}: {
  provider: EditableProvider;
  onClose: () => void;
  onSaved: () => void;
}): EditCustomProviderDialogViewProps {
  const queryClient = useQueryClient();
  // The row this dialog opens from is drawn from the catalog, so the catalog has been read.
  const catalog = useModelCatalog().data!;
  const draft = useCustomProviderDraft(catalog.customApis, provider);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.ready || busy) return;
    setBusy(true);
    try {
      await draft.save();
      toast.success(copy.custom.saved(draft.name));
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onSaved();
      onClose();
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    name: provider.label,
    form: draft.form,
    tests: draft.tests,
    ready: draft.ready,
    busy,
    onSubmit: () => void save(),
    onClose: () => {
      if (!busy) onClose();
    },
  };
}
