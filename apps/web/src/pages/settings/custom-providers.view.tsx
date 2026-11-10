/**
 * A person's own endpoints as they look, in the row language of Settings: the connection form of
 * the add and edit dialogs, an endpoint's row in Providers, and its models listed under that row.
 * The dialog shell and card picker here are the add dialog's too.
 */
import { wording } from "../../config.ts";
import { Button as UiButton, Switch } from "@corbits/react-ui";
import {
  Dialog,
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
import { InfoTooltip, Tooltip } from "@corbits/react-ui/ui/tooltip";
import { ChevronDown, Ellipsis, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Button,
  DangerMenuItem,
  QuietButton,
  QuietState,
} from "../../components.jsx";
import { ProviderLogo } from "./provider-logos.tsx";
import { ProviderFormBody } from "./provider-form.tsx";
import {
  SettingsInput,
  SettingsRow,
  SettingsRowValue,
} from "./settings-row.tsx";
import styles from "./custom-providers.module.css";

const copy = wording.providers;
const tips = copy.custom.tips;

/** A model as typed; its token counts stay text until the list is saved. */
export type ModelFields = {
  id: string;
  label: string;
  contextWindow: string;
  maxOutputTokens: string;
};

/** An endpoint's connection as typed. */
export type EndpointFields = {
  name: string;
  /** The API type picked, one of the form's `apis`. */
  api: string;
  baseUrl: string;
  apiKey: string;
  /** The server needs no key, so the form asks for none. */
  keyless: boolean;
};

export type CustomProviderFormViewProps = {
  endpoint: EndpointFields;
  onEndpointChange: (endpoint: EndpointFields) => void;
  /** The API types an endpoint can speak, each a card with the path it serves and what uses it. */
  apis: readonly { id: string; label: string; path: string; tip: string }[];
  /** A saved endpoint's API type or base URL was changed, so the form asks for its key again. */
  keyAgain: boolean;
  /** The one model a new endpoint is added with; null for a saved endpoint, whose models sit under its row. */
  firstModel: ModelFields | null;
  onFirstModelChange: (model: ModelFields) => void;
  disabled: boolean;
};

/** The form inside a dialog, which disables it while the dialog is busy. */
export type CustomProviderFields = Omit<
  CustomProviderFormViewProps,
  "disabled"
>;

export type EditCustomProviderDialogViewProps = {
  /** The endpoint's saved name. */
  name: string;
  form: CustomProviderFields;
  /** Saving makes a new connection, which is tested first. */
  tests: boolean;
  /** Enough is filled in to save. */
  ready: boolean;
  /** Testing and saving; the form and both buttons wait. */
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
};

export type CustomProviderRowViewProps = {
  /** Tells this endpoint's list of models from another's. */
  id: string;
  name: string;
  hint: string;
  modelCount: number;
  /** Its models, shown once the person opens the list. */
  models: ReactNode;
  /** Its connection speaks an API the form can edit. */
  editable: boolean;
  /** Being removed; the menu's items wait. */
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  /** The dialog editing its connection, while it is open. */
  editor: ReactNode;
};

export type SaveState = "saving" | "saved" | "failed";

export type CustomProviderModelsViewProps = {
  /** The models as typed; a fixed one is saved, so its id is no longer edited. */
  models: readonly (ModelFields & { fixed: boolean })[];
  /** Two models share an id, which the heads say in place of the save state. */
  duplicateIds: boolean;
  /** How saving the list went; null until a change is saved. */
  saveState: SaveState | null;
  onModelChange: (index: number, model: ModelFields) => void;
  /** The person left a field, which saves the list once it is complete. */
  onModelCommit: () => void;
  onRemoveModel: (index: number) => void;
  onAddModel: () => void;
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
  key: keyof ModelFields;
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

/** Title, lead, the fields, and Cancel or Back beside the dialog's action. */
export function ProviderDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
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
  const { busy, onBack, onOpenChange } = props;
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
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <ProviderFormBody rows={props.rows ?? false}>
            {props.children}
          </ProviderFormBody>
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
  layout = "cards",
  onChoose,
}: {
  providers: readonly {
    id: string;
    label: string;
    hint: string;
    tip?: string;
  }[];
  chosenId: string | undefined;
  disabled: boolean;
  labelledBy: string;
  /** Cards that fill the row, or the three compact API types of a custom endpoint. */
  layout?: "cards" | "apis";
  onChoose: (id: string) => void;
}) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = STEP[event.key];
    let target: number | undefined;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = providers.length - 1;
    else if (step !== undefined)
      target = (index + step + providers.length) % providers.length;
    const provider = target === undefined ? undefined : providers[target];
    if (target === undefined || !provider) return;
    event.preventDefault();
    onChoose(provider.id);
    cards.current[target]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={styles.picker}
      data-slot="provider-picker"
      data-layout={layout}
    >
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
            className={styles.card}
            onClick={() => onChoose(provider.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className={styles.cardHead}>
              <span className={styles.cardLogo}>
                <ProviderLogo providerId={provider.id} />
              </span>
              <b>{provider.label}</b>
            </span>
            <span className={styles.hint}>{provider.hint}</span>
          </button>
        );
        return provider.tip ? (
          <Tooltip key={provider.id} label={provider.tip}>
            {card}
          </Tooltip>
        ) : (
          card
        );
      })}
    </div>
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
    <SettingsRow
      label={
        <>
          {htmlFor ? (
            <label htmlFor={htmlFor}>{label}</label>
          ) : (
            <label id={labelId}>{label}</label>
          )}
          <InfoTooltip label={tip} triggerLabel={copy.custom.about(label)} />
        </>
      }
      hint={hint}
    >
      {children}
    </SettingsRow>
  );
}

/** One endpoint's connection as Settings rows, and the first model when it is a new one. */
export function CustomProviderFormView({
  endpoint,
  onEndpointChange,
  apis,
  keyAgain,
  firstModel,
  onFirstModelChange,
  disabled,
}: CustomProviderFormViewProps) {
  return (
    <>
      <FieldRow label={copy.custom.name} tip={tips.name} htmlFor="custom-name">
        <SettingsInput
          id="custom-name"
          autoComplete="off"
          value={endpoint.name}
          disabled={disabled}
          onChange={(event) =>
            onEndpointChange({ ...endpoint, name: event.target.value })
          }
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
          id: api.id,
          label: api.label,
          hint: api.path.replaceAll("/", "/\u200b"),
          tip: api.tip,
        }))}
        chosenId={endpoint.api}
        disabled={disabled}
        labelledBy="custom-api-label"
        layout="apis"
        onChoose={(api) => onEndpointChange({ ...endpoint, api })}
      />
      <FieldRow
        label={copy.baseUrl}
        tip={tips.baseUrl}
        htmlFor="provider-base-url"
      >
        <SettingsInput
          id="provider-base-url"
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/v1"
          value={endpoint.baseUrl}
          disabled={disabled}
          onChange={(event) =>
            onEndpointChange({ ...endpoint, baseUrl: event.target.value })
          }
        />
      </FieldRow>
      {endpoint.keyless ? null : (
        <FieldRow
          label={copy.key}
          tip={tips.key}
          htmlFor="provider-key"
          hint={keyAgain ? copy.custom.keyAgain : null}
        >
          <SettingsInput
            id="provider-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={endpoint.apiKey}
            disabled={disabled}
            onChange={(event) =>
              onEndpointChange({ ...endpoint, apiKey: event.target.value })
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
          checked={endpoint.keyless}
          disabled={disabled}
          onCheckedChange={(keyless) =>
            onEndpointChange({ ...endpoint, keyless, apiKey: "" })
          }
        />
      </FieldRow>
      {firstModel === null ? null : (
        <>
          <ModelHeader duplicate={false} />
          <ModelRow
            model={firstModel}
            editableId
            disabled={disabled}
            onChange={onFirstModelChange}
          />
        </>
      )}
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
    <SettingsRow
      label={
        <>
          {copy.custom.modelId}
          <InfoTooltip
            label={tips.modelId}
            triggerLabel={copy.custom.about(copy.custom.modelId)}
          />
        </>
      }
      hint={
        duplicate ? (
          <span role="alert">{copy.custom.duplicateIds}</span>
        ) : (
          children
        )
      }
    >
      <SettingsRowValue>
        {MODEL_FIELDS.map((field) => (
          <span key={field.key} className={styles.tokenHead}>
            {field.label}
            <InfoTooltip
              label={field.tip}
              triggerLabel={copy.custom.about(field.label)}
            />
          </span>
        ))}
        {removable ? (
          <span className={styles.tokenRemove} aria-hidden="true" />
        ) : null}
      </SettingsRowValue>
    </SettingsRow>
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
  model: ModelFields;
  editableId: boolean;
  disabled: boolean;
  onChange: (model: ModelFields) => void;
  onCommit?: () => void;
  children?: ReactNode;
}) {
  const blur = onCommit ? { onBlur: onCommit } : {};
  return (
    <SettingsRow
      label={
        editableId ? (
          <SettingsInput
            size="token"
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
          model.id
        )
      }
    >
      <SettingsRowValue>
        {MODEL_FIELDS.map((field) => (
          <SettingsInput
            key={field.key}
            size="token"
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
      </SettingsRowValue>
    </SettingsRow>
  );
}

/**
 * A custom provider's row in Providers: its options menu, and its models listed under it on
 * request.
 */
export function CustomProviderRowView({
  id,
  name,
  hint,
  modelCount,
  models,
  editable,
  removing,
  onEdit,
  onRemove,
  editor,
}: CustomProviderRowViewProps) {
  const [open, setOpen] = useState(false);
  const listId = `custom-models-${id}`;
  return (
    <>
      <SettingsRow label={name} hint={hint}>
        <SettingsRowValue>
          <QuietButton
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {copy.custom.modelCount(modelCount)}
            <ChevronDown aria-hidden="true" size={12} />
          </QuietButton>
          <CustomProviderActions
            name={name}
            editable={editable}
            removing={removing}
            onEdit={onEdit}
            onRemove={onRemove}
          />
          {editor}
        </SettingsRowValue>
      </SettingsRow>
      {open ? (
        <div id={listId} className={styles.customModels}>
          {models}
        </div>
      ) : null}
    </>
  );
}

/** An endpoint's models, each edited in place. */
export function CustomProviderModelsView({
  models,
  duplicateIds,
  saveState,
  onModelChange,
  onModelCommit,
  onRemoveModel,
  onAddModel,
}: CustomProviderModelsViewProps) {
  return (
    <>
      <ModelHeader duplicate={duplicateIds} removable>
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
          onChange={(next) => onModelChange(index, next)}
          onCommit={onModelCommit}
        >
          <UiButton
            variant="ghost"
            size="icon"
            aria-label={copy.custom.removeModel(model.id)}
            disabled={models.length === 1}
            onClick={() => onRemoveModel(index)}
          >
            <X aria-hidden="true" />
          </UiButton>
        </ModelRow>
      ))}
      <SettingsRow>
        <Button variant="ghost" onClick={onAddModel}>
          {copy.custom.addModel}
        </Button>
      </SettingsRow>
    </>
  );
}

/** One custom provider's options menu: edit its connection, or remove it. */
function CustomProviderActions({
  name,
  editable,
  removing,
  onEdit,
  onRemove,
}: {
  name: string;
  editable: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  // Removing takes two clicks, both in the menu, as deleting a project does.
  const [confirming, setConfirming] = useState(false);
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) setConfirming(false);
      }}
    >
      <MenuTrigger asChild>
        <UiButton
          variant="ghost"
          size="icon"
          aria-label={copy.custom.options(name)}
        >
          <Ellipsis aria-hidden="true" />
        </UiButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem disabled={removing || !editable} onSelect={onEdit}>
          {copy.custom.edit}
        </MenuItem>
        <MenuSeparator />
        {confirming ? (
          <DangerMenuItem disabled={removing} onSelect={onRemove}>
            {copy.custom.confirmRemove}
          </DangerMenuItem>
        ) : (
          <DangerMenuItem
            disabled={removing}
            onSelect={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
          >
            {copy.custom.remove}
          </DangerMenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

export function EditCustomProviderDialogView({
  name,
  form,
  tests,
  ready,
  busy,
  onSubmit,
  onClose,
}: EditCustomProviderDialogViewProps) {
  return (
    <ProviderDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={copy.custom.editTitle(name)}
      description={copy.custom.editLead}
      busy={busy}
      ready={ready}
      tests={tests}
      onSubmit={onSubmit}
      rows
      focusDialog
    >
      <CustomProviderFormView {...form} disabled={busy} />
    </ProviderDialog>
  );
}
