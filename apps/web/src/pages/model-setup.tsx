/**
 * The screen before the project list, when no model credential reaches this
 * workspace (its own or the server's): a tile per subscription login, then a
 * tile per API-key provider opening the Add provider dialog Settings uses.
 */
import { AddProviderDialog } from "./settings/add-provider-dialog.tsx";
import {
  useEnableAiDialog,
  useModelSetup,
  type EnableAiDialogProps,
  type ModelSetupProps,
} from "./model-setup.model.ts";
import { EnableAiDialogView, ModelSetupView } from "./model-setup.view.tsx";

export function ModelSetup(props: ModelSetupProps) {
  const { view, providerDialog } = useModelSetup(props);
  return (
    <>
      <ModelSetupView {...view} />
      <AddProviderDialog key={providerDialog.providerId} {...providerDialog} />
    </>
  );
}

/** The same tiles over the open project, so connecting never leaves it. */
export function EnableAiDialog(props: EnableAiDialogProps) {
  const { view, providerDialog } = useEnableAiDialog(props);
  return (
    <>
      <EnableAiDialogView {...view} />
      <AddProviderDialog key={providerDialog.providerId} {...providerDialog} />
    </>
  );
}
