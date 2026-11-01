/**
 * A person's own endpoints, in the row language of Settings: adding and editing one's connection
 * in a dialog of rows, and its models under its row in Providers.
 *
 * The connection is a name, the API it speaks, a base URL, and a key or Keyless. The hub keeps the
 * key on the base URL it was entered for, so a new API type, base URL or key is a new connection
 * and is tested before it is saved, like any other key; a keyless server is tested with no key at
 * all. The hub needs one model to add a provider, so the add dialog asks for the first; the rest
 * are managed under the row. The dialog shell and card picker here are the add dialog's too.
 */
import { wording } from "../config.ts";
import { Button as UiButton, Switch } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { InfoTooltip } from "@corbits/react-ui/ui/tooltip";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Ellipsis, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type {
  CustomApi,
  CustomModel,
  CustomProviderCreate,
  ModelCatalog,
  ModelProvider,
} from "@corbits-builder/schemas/models";
import { Banner, Button, QuietState } from "../components.jsx";
import { keys } from "../queries/keys.ts";
import { productClient } from "../api/transport.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { ProviderLogo } from "./provider-logos.tsx";

const copy = wording.providers;
const tips = copy.custom.tips;

type ModelDraft = {
  id: string;
  label: string;
  contextWindow: string;
  maxOutputTokens: string;
};

type CustomDraft = {
  name: string;
  api: CustomApi;
  baseURL: string;
  secret: string;
  keyless: boolean;
  model: ModelDraft;
};

type Apis = ModelCatalog["customApis"];

type SaveState = "saving" | "saved" | "failed";

// A model listed under its provider; a fixed one is saved, so its id is no longer edited.
type ListedModel = ModelDraft & { fixed: boolean };

const BLANK_MODEL: ModelDraft = {
  id: "",
  label: "",
  contextWindow: "",
  maxOutputTokens: "",
};

const BLANK_DRAFT: CustomDraft = {
  name: "",
  api: "openai-compatible",
  baseURL: "",
  secret: "",
  keyless: false,
  model: BLANK_MODEL,
};

// The fields of a model after its id, each a column under the list's heads.
const MODEL_FIELDS = [
  { key: "label", label: copy.custom.modelName, tip: tips.modelName },
  {
    key: "contextWindow",
    label: copy.custom.contextWindow,
    tip: tips.contextWindow,
  },
  {
    key: "maxOutputTokens",
    label: copy.custom.maxOutputTokens,
    tip: tips.maxOutputTokens,
  },
] as const satisfies readonly {
  key: keyof ModelDraft;
  label: string;
  tip: string;
}[];

const SUBMIT_LABELS = {
  test: { idle: copy.test, busy: copy.testing },
  save: { idle: copy.custom.save, busy: copy.custom.saving },
} as const;

const SAVE_STATES = {
  saving: { tone: "loading", label: copy.custom.saving },
  saved: { tone: "success", label: copy.custom.savedState },
  failed: { tone: "error", label: copy.custom.failedState },
} as const satisfies Record<SaveState, { tone: string; label: string }>;

const STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Title, lead, the fields, the last error, and Cancel or Back beside the dialog's action. */
export function ProviderDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  error: string | null;
  busy: boolean;
  ready: boolean;
  /** Whether submitting tests a connection first. */
  tests: boolean;
  onSubmit: () => void;
  /** Shown in place of Cancel when the dialog was reached from another view of itself. */
  onBack?: (() => void) | undefined;
  /** Fields laid out as Settings rows rather than stacked. */
  rows?: boolean;
  /** Opens with focus on the dialog itself, so no field opens with its text selected. */
  focusDialog?: boolean;
  children: ReactNode;
}) {
  const { busy, error, onBack, onOpenChange } = props;
  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent
        {...(props.focusDialog
          ? {
              onOpenAutoFocus: (event: Event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement).focus();
              },
            }
          : {})}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form
          className="provider-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <DialogBody
            className={
              props.rows ? "provider-form settings-rows" : "provider-form"
            }
          >
            {props.children}
            {error ? <Banner tone="error" title={error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={onBack ?? (() => onOpenChange(false))}
            >
              {onBack ? copy.custom.back : wording.action.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={busy}
              disabled={!props.ready}
            >
              {
                SUBMIT_LABELS[props.tests ? "test" : "save"][
                  busy ? "busy" : "idle"
                ]
              }
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One card per choice, as a radio group: arrow keys move the choice, Tab leaves the group. A
 * choice with a `tip` explains itself on hover or focus.
 */
export function ProviderPicker({
  providers,
  chosenId,
  disabled,
  labelledBy,
  className = "provider-cards",
  onChoose,
}: {
  providers: readonly (Pick<ModelProvider, "id" | "label" | "hint"> & {
    tip?: string;
  })[];
  chosenId: string | undefined;
  disabled: boolean;
  labelledBy: string;
  className?: string;
  onChoose: (id: string) => void;
}) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = STEP[event.key];
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? providers.length - 1
          : step === undefined
            ? undefined
            : (index + step + providers.length) % providers.length;
    const provider = target === undefined ? undefined : providers[target];
    if (target === undefined || !provider) return;
    event.preventDefault();
    onChoose(provider.id);
    cards.current[target]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={className}>
      {providers.map((provider, index) => {
        const checked = provider.id === chosenId;
        const card = (
          <button
            key={provider.id}
            ref={(element) => {
              cards.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className="provider-card"
            onClick={() => onChoose(provider.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="provider-card-head">
              <span className="provider-card-logo">
                <ProviderLogo providerId={provider.id} />
              </span>
              <b>{provider.label}</b>
            </span>
            <span className="provider-hint">{provider.hint}</span>
          </button>
        );
        return provider.tip ? (
          <Tip key={provider.id} label={provider.tip}>
            {card}
          </Tip>
        ) : (
          card
        );
      })}
    </div>
  );
}

/** The library's info-tooltip surface around any trigger; the library only offers it on its glyph. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            data-slot="tooltip-content"
            sideOffset={6}
            className="z-50 max-w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg"
          >
            {label}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/** A Settings row: its label with a tooltip, an optional hint, and its control on the right. */
function FieldRow({
  label,
  tip,
  htmlFor,
  labelId,
  hint,
  children,
}: {
  label: string;
  tip: string;
  htmlFor?: string;
  /** Names a group the row heads, when it labels no single control. */
  labelId?: string;
  hint?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="row">
      <div className="k">
        <b>
          {htmlFor ? (
            <label htmlFor={htmlFor}>{label}</label>
          ) : (
            <label id={labelId}>{label}</label>
          )}
          <InfoTooltip label={tip} triggerLabel={copy.custom.about(label)} />
        </b>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function keylessOf(provider: ModelProvider): boolean {
  return provider.connections.some((connection) => connection.keyless);
}

function draftOf(provider: ModelProvider): CustomDraft {
  return {
    name: provider.label,
    api: provider.plugin as CustomApi,
    baseURL: provider.baseURL,
    secret: "",
    keyless: keylessOf(provider),
    model: BLANK_MODEL,
  };
}

function modelDraftOf(model: ModelProvider["models"][number]): ModelDraft {
  return {
    id: model.id,
    label: model.label ?? "",
    contextWindow: "contextWindow" in model ? String(model.contextWindow) : "",
    maxOutputTokens:
      "maxOutputTokens" in model ? String(model.maxOutputTokens) : "",
  };
}

function tokens(value: string): number | null {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function duplicateIds(models: readonly ModelDraft[]): boolean {
  const ids = models.map((model) => model.id.trim()).filter(Boolean);
  return new Set(ids).size !== ids.length;
}

/** The models drafted, once every id is set and distinct and each output cap is below its window. */
function parsedModels(models: readonly ModelDraft[]): CustomModel[] | null {
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
    draft.baseURL.trim() !== original.baseURL ||
    draft.keyless !== keylessOf(original) ||
    draft.secret.trim().length > 0
  );
}

function endpointOf(draft: CustomDraft): CustomProviderCreate["connection"] {
  const endpoint = { api: draft.api, baseURL: draft.baseURL.trim() };
  return draft.keyless
    ? { ...endpoint, keyless: true }
    : { ...endpoint, secret: draft.secret.trim() };
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
 * One custom provider's connection form: its rows, whether it can be submitted, whether
 * submitting tests a new connection first, and `save`, which throws a failed test's reason.
 */
export function useCustomProviderForm(apis: Apis, original?: ModelProvider) {
  const [draft, setDraft] = useState(() =>
    original ? draftOf(original) : BLANK_DRAFT,
  );
  const tests = reconnects(draft, original);
  const keyed = draft.keyless || draft.secret.trim().length > 0;
  return {
    name: draft.name.trim(),
    tests,
    ready:
      draft.name.trim().length > 0 &&
      draft.baseURL.trim().length > 0 &&
      (!tests || keyed) &&
      (original !== undefined || parsedModels([draft.model]) !== null),
    reset: () => setDraft(BLANK_DRAFT),
    rows: (disabled: boolean) => (
      <>
        <ConnectionRows
          draft={draft}
          apis={apis}
          disabled={disabled}
          original={original}
          onChange={setDraft}
        />
        {original ? null : (
          <FirstModelRows
            model={draft.model}
            disabled={disabled}
            onChange={(model) => setDraft({ ...draft, model })}
          />
        )}
      </>
    ),
    save: async (): Promise<void> => {
      if (tests) await testConnection(draft);
      const tenantId = await workspaceTenantId();
      const client = productClient();
      const name = draft.name.trim();
      if (!original) {
        await client.createCustomProvider(tenantId, {
          name,
          models: parsedModels([draft.model])!,
          connection: endpointOf(draft),
        });
        return;
      }
      await client.updateCustomProvider(tenantId, original.id, {
        name,
        models: parsedModels(original.models.map(modelDraftOf))!,
        ...(tests ? { connection: endpointOf(draft) } : {}),
      });
    },
  };
}

function ConnectionRows({
  draft,
  apis,
  disabled,
  original,
  onChange,
}: {
  draft: CustomDraft;
  apis: Apis;
  disabled: boolean;
  original: ModelProvider | undefined;
  onChange: (draft: CustomDraft) => void;
}) {
  const keyAgain =
    original !== undefined &&
    (draft.api !== original.plugin ||
      draft.baseURL.trim() !== original.baseURL);
  return (
    <>
      <FieldRow label={copy.custom.name} tip={tips.name} htmlFor="custom-name">
        <input
          id="custom-name"
          className="field"
          autoComplete="off"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </FieldRow>
      <FieldRow
        label={copy.custom.api}
        tip={tips.api}
        labelId="custom-api-label"
        hint={copy.custom.apiLead}
      />
      <ProviderPicker
        providers={apis.map((api) => ({
          ...api,
          hint: copy.custom.apiPaths[api.id].replaceAll("/", "/\u200b"),
          tip: copy.custom.apiTips[api.id],
        }))}
        chosenId={draft.api}
        disabled={disabled}
        labelledBy="custom-api-label"
        className="api-options"
        onChoose={(api) => onChange({ ...draft, api: api as CustomApi })}
      />
      <FieldRow
        label={copy.baseUrl}
        tip={tips.baseUrl}
        htmlFor="provider-base-url"
      >
        <input
          id="provider-base-url"
          className="field"
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/v1"
          value={draft.baseURL}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, baseURL: event.target.value })
          }
        />
      </FieldRow>
      {draft.keyless ? null : (
        <FieldRow
          label={copy.key}
          tip={tips.key}
          htmlFor="provider-key"
          hint={keyAgain ? copy.custom.keyAgain : null}
        >
          <input
            id="provider-key"
            className="field"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft.secret}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...draft, secret: event.target.value })
            }
          />
        </FieldRow>
      )}
      <FieldRow
        label={copy.keyless}
        tip={copy.keylessHint}
        htmlFor="custom-keyless"
      >
        <Switch
          id="custom-keyless"
          checked={draft.keyless}
          disabled={disabled}
          onCheckedChange={(keyless) =>
            onChange({ ...draft, keyless, secret: "" })
          }
        />
      </FieldRow>
    </>
  );
}

/** The column heads of a model list, each with its tooltip, and a save state when there is one. */
function ModelHeader({
  duplicate,
  removable = false,
  children,
}: {
  duplicate: boolean;
  /** Whether the rows under it end in a remove button, which the heads leave room for. */
  removable?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="row">
      <div className="k">
        <b>
          {copy.custom.modelId}
          <InfoTooltip
            label={tips.modelId}
            triggerLabel={copy.custom.about(copy.custom.modelId)}
          />
        </b>
        {duplicate ? (
          <span role="alert">{copy.custom.duplicateIds}</span>
        ) : (
          children
        )}
      </div>
      <span className="v">
        {MODEL_FIELDS.map((field) => (
          <span key={field.key} className="token-field token-head">
            {field.label}
            <InfoTooltip
              label={field.tip}
              triggerLabel={copy.custom.about(field.label)}
            />
          </span>
        ))}
        {removable ? (
          <span className="token-remove" aria-hidden="true" />
        ) : null}
      </span>
    </div>
  );
}

/** One model as a row of quiet fields; its id is a field until it is saved. */
function ModelRow({
  model,
  editableId,
  disabled,
  onChange,
  onCommit,
  children,
}: {
  model: ModelDraft;
  editableId: boolean;
  disabled: boolean;
  onChange: (model: ModelDraft) => void;
  onCommit?: () => void;
  children?: ReactNode;
}) {
  const blur = onCommit ? { onBlur: onCommit } : {};
  return (
    <div className="row">
      <div className="k">
        {editableId ? (
          <input
            className="field token-field"
            aria-label={copy.custom.modelId}
            placeholder={copy.custom.modelId}
            autoComplete="off"
            spellCheck={false}
            value={model.id}
            disabled={disabled}
            onChange={(event) => onChange({ ...model, id: event.target.value })}
            {...blur}
          />
        ) : (
          <b>{model.id}</b>
        )}
      </div>
      <span className="v">
        {MODEL_FIELDS.map((field) => (
          <input
            key={field.key}
            className="field token-field"
            aria-label={`${model.id || copy.custom.modelId} ${field.label}`}
            autoComplete="off"
            spellCheck={false}
            {...(field.key === "label"
              ? { placeholder: model.id.trim() || copy.custom.optional }
              : { type: "number", inputMode: "numeric" as const, min: 1 })}
            value={model[field.key]}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...model, [field.key]: event.target.value })
            }
            {...blur}
          />
        ))}
        {children}
      </span>
    </div>
  );
}

/** The one model a provider is added with, laid out as the list under its row will show it. */
function FirstModelRows({
  model,
  disabled,
  onChange,
}: {
  model: ModelDraft;
  disabled: boolean;
  onChange: (model: ModelDraft) => void;
}) {
  return (
    <>
      <ModelHeader duplicate={false} />
      <ModelRow
        model={model}
        editableId
        disabled={disabled}
        onChange={onChange}
      />
    </>
  );
}

/**
 * A custom provider's row in Providers: its options menu, and its models listed under it on
 * request, each edited in place and saved once it is complete.
 */
export function CustomProviderRow({
  provider,
  apis,
  onChanged,
  onError,
}: {
  provider: ModelProvider;
  apis: Apis;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `custom-models-${provider.id}`;
  return (
    <>
      <div className="row">
        <div className="k">
          <b>{provider.label}</b>
          <span>{provider.hint}</span>
        </div>
        <span className="v">
          <button
            type="button"
            className="quiet-control models-toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {copy.custom.modelCount(provider.models.length)}
            <ChevronDown aria-hidden="true" size={12} />
          </button>
          <CustomProviderActions
            provider={provider}
            apis={apis}
            onChanged={onChanged}
            onError={onError}
          />
        </span>
      </div>
      {open ? (
        <div id={listId} className="custom-models">
          <CustomProviderModels provider={provider} onChanged={onChanged} />
        </div>
      ) : null}
    </>
  );
}

function CustomProviderModels({
  provider,
  onChanged,
}: {
  provider: ModelProvider;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [models, setModels] = useState<ListedModel[]>(() =>
    provider.models.map((model) => ({ ...modelDraftOf(model), fixed: true })),
  );
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(JSON.stringify(parsedModels(models)));

  // Saves once the list is complete and differs from what the hub holds; a half-typed model waits.
  const commit = async (next: readonly ListedModel[]) => {
    const parsed = parsedModels(next);
    const snapshot = JSON.stringify(parsed);
    if (!parsed || snapshot === saved.current) return;
    setSaveState("saving");
    setError(null);
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
      setError(message(cause));
    }
  };

  return (
    <>
      <ModelHeader duplicate={duplicateIds(models)} removable>
        {saveState ? (
          <QuietState tone={SAVE_STATES[saveState].tone}>
            {SAVE_STATES[saveState].label}
          </QuietState>
        ) : null}
      </ModelHeader>
      {models.map((model, index) => (
        <ModelRow
          key={index}
          model={model}
          editableId={!model.fixed}
          disabled={false}
          onChange={(next) =>
            setModels(
              models.map((entry, at) =>
                at === index ? { ...next, fixed: model.fixed } : entry,
              ),
            )
          }
          onCommit={() => void commit(models)}
        >
          <UiButton
            variant="ghost"
            size="icon"
            aria-label={copy.custom.removeModel(model.id)}
            disabled={models.length === 1}
            onClick={() => {
              const rest = models.filter((_, at) => at !== index);
              setModels(rest);
              void commit(rest);
            }}
          >
            <X aria-hidden="true" />
          </UiButton>
        </ModelRow>
      ))}
      <div className="row">
        <Button
          variant="ghost"
          onClick={() =>
            setModels([...models, { ...BLANK_MODEL, fixed: false }])
          }
        >
          {copy.custom.addModel}
        </Button>
      </div>
      {error ? <Banner tone="error" title={error} /> : null}
    </>
  );
}

/** One custom provider's options menu: edit its connection, or remove it. */
function CustomProviderActions({
  provider,
  apis,
  onChanged,
  onError,
}: {
  provider: ModelProvider;
  apis: Apis;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Removing takes two clicks, both in the menu, as deleting a project does.
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    setRemoving(true);
    onError(null);
    try {
      await productClient().removeCustomProvider(
        await workspaceTenantId(),
        provider.id,
      );
      toast.success(copy.custom.removed(provider.label));
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onChanged();
    } catch (cause) {
      onError(message(cause));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <MenuTrigger asChild>
          <UiButton
            variant="ghost"
            size="icon"
            aria-label={copy.custom.options(provider.label)}
          >
            <Ellipsis aria-hidden="true" />
          </UiButton>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem disabled={removing} onSelect={() => setEditing(true)}>
            {copy.custom.edit}
          </MenuItem>
          <MenuSeparator />
          {confirming ? (
            <MenuItem
              className="menu-danger"
              disabled={removing}
              onSelect={() => void remove()}
            >
              {copy.custom.confirmRemove}
            </MenuItem>
          ) : (
            <MenuItem
              className="menu-danger"
              disabled={removing}
              onSelect={(event) => {
                event.preventDefault();
                setConfirming(true);
              }}
            >
              {copy.custom.remove}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {editing ? (
        <EditCustomProviderDialog
          provider={provider}
          apis={apis}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}

function EditCustomProviderDialog({
  provider,
  apis,
  onClose,
  onSaved,
}: {
  provider: ModelProvider;
  apis: Apis;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useCustomProviderForm(apis, provider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!form.ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await form.save();
      toast.success(copy.custom.saved(form.name));
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onSaved();
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProviderDialog
      open
      onOpenChange={(open) => (open || busy ? undefined : onClose())}
      title={copy.custom.editTitle(provider.label)}
      description={copy.custom.editLead}
      error={error}
      busy={busy}
      ready={form.ready}
      tests={form.tests}
      onSubmit={() => void save()}
      rows
      focusDialog
    >
      {form.rows(busy)}
    </ProviderDialog>
  );
}
