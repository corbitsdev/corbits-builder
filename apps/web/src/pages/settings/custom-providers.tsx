/**
 * A person's own endpoints, in the row language of Settings: adding and editing one's connection
 * in a dialog of rows, and its models under its row in Providers. `custom-providers.model.ts`
 * holds what they do and `custom-providers.view.tsx` how they look.
 */
import type { ModelProvider } from "@corbits-builder/schemas/models";
import {
  useCustomProviderModels,
  useCustomProviderRow,
  useEditCustomProvider,
  type EditableProvider,
} from "./custom-providers.model.ts";
import {
  CustomProviderModelsView,
  CustomProviderRowView,
  EditCustomProviderDialogView,
} from "./custom-providers.view.tsx";

/**
 * A custom provider's row in Providers: its options menu, and its models listed under it on
 * request, each edited in place and saved once it is complete.
 */
export function CustomProviderRow({
  provider,
  onChanged,
}: {
  provider: ModelProvider;
  onChanged: () => void;
}) {
  const { view, editing, onEditorClose } = useCustomProviderRow({
    provider,
    onChanged,
  });
  return (
    <CustomProviderRowView
      {...view}
      models={
        <CustomProviderModels provider={provider} onChanged={onChanged} />
      }
      editor={
        editing === null ? null : (
          <EditCustomProviderDialog
            provider={editing}
            onClose={onEditorClose}
            onSaved={onChanged}
          />
        )
      }
    />
  );
}

function CustomProviderModels(props: {
  provider: ModelProvider;
  onChanged: () => void;
}) {
  return <CustomProviderModelsView {...useCustomProviderModels(props)} />;
}

function EditCustomProviderDialog(props: {
  provider: EditableProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  return <EditCustomProviderDialogView {...useEditCustomProvider(props)} />;
}
