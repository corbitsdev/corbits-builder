import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import {
  CustomProviderFormView,
  CustomProviderModelsView,
  CustomProviderRowView,
  EditCustomProviderDialogView,
  ProviderDialog,
  type CustomProviderFields,
  type CustomProviderModelsViewProps,
  type CustomProviderRowViewProps,
  type EditCustomProviderDialogViewProps,
} from "./custom-providers.view.tsx";
import { SettingsSectionBody } from "./settings-section.tsx";

const copy = wording.providers.custom;

const meta = {
  title: "Screens/Settings/CustomProvider",
} satisfies Meta;

export default meta;

const apis = (
  [
    { id: "openai-compatible", label: "OpenAI Chat Completions" },
    { id: "openai-responses", label: "OpenAI Responses" },
    { id: "anthropic", label: "Anthropic Messages" },
  ] as const
).map((api) => ({
  ...api,
  path: copy.apiPaths[api.id],
  tip: copy.apiTips[api.id],
}));

const blankModel = {
  id: "",
  label: "",
  contextWindow: "",
  maxOutputTokens: "",
};

const blankForm: CustomProviderFields = {
  endpoint: {
    name: "",
    api: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    keyless: false,
  },
  onEndpointChange: fn(),
  apis,
  keyAgain: false,
  firstModel: blankModel,
  onFirstModelChange: fn(),
};

const filledForm: CustomProviderFields = {
  ...blankForm,
  endpoint: {
    name: "Office vLLM",
    api: "openai-compatible",
    baseUrl: "https://llm.example.com/v1",
    apiKey: "sk-office-0000",
    keyless: false,
  },
  firstModel: {
    id: "qwen3-coder-32b",
    label: "Qwen3 Coder",
    contextWindow: "131072",
    maxOutputTokens: "8192",
  },
};

// Holds the endpoint and the first model being typed, as the dialog around the form does.
function useTyped(form: CustomProviderFields): CustomProviderFields {
  const [endpoint, setEndpoint] = useState(form.endpoint);
  const [firstModel, setFirstModel] = useState(form.firstModel);
  return {
    ...form,
    endpoint,
    onEndpointChange: setEndpoint,
    firstModel,
    onFirstModelChange: setFirstModel,
  };
}

type NewEndpointArgs = {
  form: CustomProviderFields;
  ready: boolean;
  busy: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onOpenChange: (open: boolean) => void;
};

// The form in the dialog of rows a new endpoint is added from.
function NewEndpoint({ form, ...dialog }: NewEndpointArgs) {
  return (
    <ProviderDialog
      {...dialog}
      open
      title={copy.addTitle}
      description={copy.addLead}
      tests
      rows
    >
      <CustomProviderFormView {...useTyped(form)} disabled={dialog.busy} />
    </ProviderDialog>
  );
}

type FormStory = StoryObj<NewEndpointArgs>;
const newEndpoint = {
  args: {
    form: filledForm,
    ready: true,
    busy: false,
    onSubmit: fn(),
    onBack: fn(),
    onOpenChange: fn(),
  },
  render: (args) => <NewEndpoint {...args} />,
} satisfies FormStory;

export const FormEmpty: FormStory = {
  ...newEndpoint,
  args: { ...newEndpoint.args, form: blankForm, ready: false },
};

export const FormFilled: FormStory = newEndpoint;

/** A server that needs no key: the key row is gone. */
export const FormKeyless: FormStory = {
  ...newEndpoint,
  args: {
    ...newEndpoint.args,
    form: {
      ...filledForm,
      endpoint: { ...filledForm.endpoint, apiKey: "", keyless: true },
    },
  },
};

/** An output cap that is not below the context window cannot be tested. */
export const FormInvalid: FormStory = {
  ...newEndpoint,
  args: {
    ...newEndpoint.args,
    form: {
      ...filledForm,
      firstModel: {
        id: "qwen3-coder-32b",
        label: "",
        contextWindow: "8192",
        maxOutputTokens: "8192",
      },
    },
    ready: false,
  },
};

/** The connection is being tested and saved; the form and both buttons wait. */
export const FormSaving: FormStory = {
  ...newEndpoint,
  args: { ...newEndpoint.args, busy: true },
};

function EditDialog(args: EditCustomProviderDialogViewProps) {
  return <EditCustomProviderDialogView {...args} form={useTyped(args.form)} />;
}

// A saved endpoint's form: its key is never shown again, and its models sit under its row.
const savedForm: CustomProviderFields = {
  ...filledForm,
  endpoint: { ...filledForm.endpoint, apiKey: "" },
  firstModel: null,
};

type EditStory = StoryObj<EditCustomProviderDialogViewProps>;
const editing = {
  args: {
    name: "Office vLLM",
    form: savedForm,
    tests: false,
    ready: true,
    busy: false,
    onSubmit: fn(),
    onClose: fn(),
  },
  render: (args) => <EditDialog {...args} />,
} satisfies EditStory;

/** Nothing about the connection changed, so the button saves without a test. */
export const Editing: EditStory = editing;

/** A new base URL is a new connection: its key is asked for again and it is tested first. */
export const EditingNeedsKeyAgain: EditStory = {
  ...editing,
  args: {
    ...editing.args,
    form: {
      ...savedForm,
      endpoint: {
        ...savedForm.endpoint,
        baseUrl: "https://llm2.example.com/v1",
      },
      keyAgain: true,
    },
    tests: true,
    ready: false,
  },
};

export const EditingSaving: EditStory = {
  ...editing,
  args: { ...editing.args, busy: true },
};

const savedModels = [
  {
    id: "qwen3-coder-32b",
    label: "Qwen3 Coder",
    contextWindow: "131072",
    maxOutputTokens: "8192",
    fixed: true,
  },
  {
    id: "llama-4-70b",
    label: "",
    contextWindow: "65536",
    maxOutputTokens: "4096",
    fixed: true,
  },
];

// Holds the models being typed, as the list's host does.
function Models(args: CustomProviderModelsViewProps) {
  const [models, setModels] = useState(args.models);
  return (
    <SettingsSectionBody>
      <CustomProviderModelsView
        {...args}
        models={models}
        onModelChange={(index, next) =>
          setModels(
            models.map((model, at) =>
              at === index ? { ...next, fixed: model.fixed } : model,
            ),
          )
        }
        onRemoveModel={(index) =>
          setModels(models.filter((_, at) => at !== index))
        }
        onAddModel={() =>
          setModels([...models, { ...blankModel, fixed: false }])
        }
      />
    </SettingsSectionBody>
  );
}

type ModelsStory = StoryObj<CustomProviderModelsViewProps>;
const modelList = {
  args: {
    models: savedModels,
    duplicateIds: false,
    saveState: null,
    onModelChange: fn(),
    onModelCommit: fn(),
    onRemoveModel: fn(),
    onAddModel: fn(),
  },
  render: (args) => <Models {...args} />,
} satisfies ModelsStory;

export const ModelList: ModelsStory = modelList;

/** A model being added: its id is a field until the list is saved. */
export const ModelBeingAdded: ModelsStory = {
  ...modelList,
  args: {
    ...modelList.args,
    models: [
      ...savedModels,
      { ...blankModel, id: "mistral-large-3", fixed: false },
    ],
  },
};

export const ModelListSaving: ModelsStory = {
  ...modelList,
  args: { ...modelList.args, saveState: "saving" },
};

export const ModelListSaved: ModelsStory = {
  ...modelList,
  args: { ...modelList.args, saveState: "saved" },
};

export const ModelListNotSaved: ModelsStory = {
  ...modelList,
  args: { ...modelList.args, saveState: "failed" },
};

export const ModelListWithDuplicateIds: ModelsStory = {
  ...modelList,
  args: {
    ...modelList.args,
    models: [
      ...savedModels,
      {
        id: "llama-4-70b",
        label: "",
        contextWindow: "65536",
        maxOutputTokens: "4096",
        fixed: false,
      },
    ],
    duplicateIds: true,
  },
};

type RowStory = StoryObj<CustomProviderRowViewProps>;
const row = {
  args: {
    id: "custom-office-vllm",
    name: "Office vLLM",
    hint: "OpenAI Chat Completions",
    modelCount: savedModels.length,
    models: <CustomProviderModelsView {...modelList.args} />,
    editable: true,
    removing: false,
    onEdit: fn(),
    onRemove: fn(),
    editor: null,
  },
  render: (args) => (
    <SettingsSectionBody>
      <CustomProviderRowView {...args} />
    </SettingsSectionBody>
  ),
} satisfies RowStory;

/** The model count opens the list of models under the row. */
export const Row: RowStory = row;

/** The hub is removing it; the menu's items wait. */
export const RowBeingRemoved: RowStory = {
  ...row,
  args: { ...row.args, removing: true },
};

/** An endpoint on an API the form does not know: its menu offers only to remove it. */
export const RowNotEditable: RowStory = {
  ...row,
  args: { ...row.args, editable: false },
};
