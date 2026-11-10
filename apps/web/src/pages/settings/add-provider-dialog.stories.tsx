import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import {
  AddProviderDialogView,
  type AddProviderDialogViewProps,
  type AddProviderStep,
} from "./add-provider-dialog.view.tsx";

const copy = wording.providers;

// Holds what the dialog asks its host to keep: the card picked, the key and the endpoint typed.
function Dialog(args: AddProviderDialogViewProps) {
  const [apiKey, setApiKey] = useState(args.apiKey);
  const [step, setStep] = useState(args.step);
  let held: AddProviderStep = step;
  if (step.kind === "pick")
    held = { ...step, onChoose: (chosenId) => setStep({ ...step, chosenId }) };
  if (step.kind === "endpoint")
    held = {
      ...step,
      form: {
        ...step.form,
        onEndpointChange: (endpoint) =>
          setStep({ ...step, form: { ...step.form, endpoint } }),
        onFirstModelChange: (firstModel) =>
          setStep({ ...step, form: { ...step.form, firstModel } }),
      },
    };
  return (
    <AddProviderDialogView
      {...args}
      step={held}
      apiKey={apiKey}
      onApiKeyChange={setApiKey}
    />
  );
}

const choices = [
  { id: "openai", label: "OpenAI", hint: "An OpenAI API key." },
  { id: "anthropic", label: "Anthropic", hint: "An Anthropic API key." },
  { id: "google", label: "Google", hint: "A Gemini API key." },
  {
    id: "xai-api",
    label: "xAI API",
    hint: "An xAI API key, from console.x.ai.",
  },
  {
    id: "custom-endpoint",
    label: copy.custom.tile,
    hint: copy.custom.tileHint,
  },
];

const apis = (
  [
    { id: "openai-compatible", label: "OpenAI Chat Completions" },
    { id: "openai-responses", label: "OpenAI Responses" },
    { id: "anthropic", label: "Anthropic Messages" },
  ] as const
).map((api) => ({
  ...api,
  path: copy.custom.apiPaths[api.id],
  tip: copy.custom.apiTips[api.id],
}));

const pick: AddProviderStep = {
  kind: "pick",
  choices,
  chosenId: "openai",
  onChoose: fn(),
};

const meta = {
  title: "Screens/Settings/AddProviderDialog",
  component: AddProviderDialogView,
  args: {
    open: true,
    onOpenChange: fn(),
    fault: null,
    step: pick,
    apiKey: "",
    onApiKeyChange: fn(),
    busy: false,
    ready: false,
    onSubmit: fn(),
  },
  render: (args) => <Dialog {...args} />,
} satisfies Meta<typeof AddProviderDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickProvider: Story = {};

export const KeyPasted: Story = {
  args: {
    step: { ...pick, chosenId: "anthropic" },
    apiKey: "sk-ant-0000",
    ready: true,
  },
};

/** The key is tried against the provider's model list, then saved; everything waits. */
export const SavingKey: Story = {
  args: { ...KeyPasted.args, busy: true },
};

// Raises the toast a refused key ends with.
function Refused(args: AddProviderDialogViewProps) {
  useEffect(() => {
    toast.error(copy.failed.refused);
  }, []);
  return <Dialog {...args} />;
}

/** The provider refused the key: a toast says so and the dialog keeps the key to correct. */
export const KeyRefused: Story = {
  args: { ...KeyPasted.args },
  render: (args) => <Refused {...args} />,
};

/** Opened for one provider, as the model setup tiles do: no cards, only its key. */
export const OneProvider: Story = {
  args: { step: { kind: "key", provider: "Anthropic" } },
};

/** The providers could not be read, so there is no card to pick. */
export const CatalogFailed: Story = {
  args: {
    fault: "The server did not answer. Try again.",
    step: { ...pick, choices: [], chosenId: undefined },
  },
};

/** Reached from the Custom endpoint card; Back returns to the cards. */
export const CustomEndpoint: Story = {
  args: {
    step: {
      kind: "endpoint",
      form: {
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
        firstModel: {
          id: "",
          label: "",
          contextWindow: "",
          maxOutputTokens: "",
        },
        onFirstModelChange: fn(),
      },
      onBack: fn(),
    },
  },
};
