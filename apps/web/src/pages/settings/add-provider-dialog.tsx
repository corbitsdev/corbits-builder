/** The one dialog that adds a model provider, from Settings, the New project page and model setup. */
import {
  useAddProviderDialog,
  type AddProviderDialogProps,
} from "./add-provider-dialog.model.ts";
import { AddProviderDialogView } from "./add-provider-dialog.view.tsx";

export function AddProviderDialog(props: AddProviderDialogProps) {
  return <AddProviderDialogView {...useAddProviderDialog(props)} />;
}
