/**
 * The Add provider dialog as it looks: pick a provider and paste its key, paste the key of the one
 * provider the dialog was opened for, or fill in a custom endpoint. It never shows a saved key.
 */
import { Input } from "@corbits/react-ui";
import { DialogFieldLabel } from "@corbits/react-ui/ui/dialog";
import { wording } from "../../config.ts";
import { Banner, Field } from "../../components.jsx";
import {
  CustomProviderFormView,
  ProviderDialog,
  ProviderPicker,
  type CustomProviderFields,
} from "./custom-providers.view.tsx";

const copy = wording.providers;

/** What the dialog asks for. */
export type AddProviderStep =
  | {
      /** A card per provider, and the key of the one picked. */
      kind: "pick";
      choices: readonly { id: string; label: string; hint: string }[];
      chosenId: string | undefined;
      onChoose: (id: string) => void;
    }
  | {
      /** The key of the one provider the dialog was opened for, by name once it is known. */
      kind: "key";
      provider: string | null;
    }
  | {
      /** A custom endpoint's fields, reached from its card. */
      kind: "endpoint";
      form: CustomProviderFields;
      onBack: () => void;
    };

export type AddProviderDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the providers could not be read. */
  fault: string | null;
  step: AddProviderStep;
  /** The key being pasted, in the two steps that ask for one. */
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  /** Testing and saving; the fields and both buttons wait. */
  busy: boolean;
  /** Enough is filled in to test. */
  ready: boolean;
  onSubmit: () => void;
};

function heading(step: AddProviderStep): {
  title: string;
  description: string;
} {
  if (step.kind === "endpoint")
    return { title: copy.custom.addTitle, description: copy.custom.addLead };
  if (step.kind === "pick")
    return { title: copy.dialogTitle, description: copy.dialogLead };
  return {
    title:
      step.provider === null
        ? copy.dialogTitle
        : copy.connectOne(step.provider),
    description: copy.keyLead,
  };
}

export function AddProviderDialogView({
  open,
  onOpenChange,
  fault,
  step,
  apiKey,
  onApiKeyChange,
  busy,
  ready,
  onSubmit,
}: AddProviderDialogViewProps) {
  return (
    <ProviderDialog
      open={open}
      onOpenChange={onOpenChange}
      {...heading(step)}
      busy={busy}
      ready={ready}
      tests
      onSubmit={onSubmit}
      onBack={step.kind === "endpoint" ? step.onBack : undefined}
      rows={step.kind === "endpoint"}
    >
      {fault === null ? null : <Banner tone="error" title={fault} />}
      {step.kind === "pick" ? (
        <Field>
          <DialogFieldLabel id="provider-choice-label">
            {copy.provider}
          </DialogFieldLabel>
          <ProviderPicker
            providers={step.choices}
            chosenId={step.chosenId}
            disabled={busy}
            labelledBy="provider-choice-label"
            onChoose={step.onChoose}
          />
        </Field>
      ) : null}
      {step.kind === "endpoint" ? (
        <CustomProviderFormView {...step.form} disabled={busy} />
      ) : (
        <Field>
          <DialogFieldLabel htmlFor="provider-key">{copy.key}</DialogFieldLabel>
          <Input
            id="provider-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            disabled={busy}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
        </Field>
      )}
    </ProviderDialog>
  );
}
