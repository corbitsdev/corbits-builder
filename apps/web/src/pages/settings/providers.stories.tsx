import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AddProviderDialogView } from "./add-provider-dialog.view.tsx";
import {
  CustomProviderModelsView,
  CustomProviderRowView,
} from "./custom-providers.view.tsx";
import {
  ProvidersSectionView,
  type KeyConnection,
  type ProvidersSectionViewProps,
} from "./providers.view.tsx";

const xai = { id: "xai", name: "xAI", connected: false };
const logins = [{ id: "codex", name: "ChatGPT", connected: false }, xai];

const anthropic: KeyConnection = {
  id: "conn-anthropic",
  name: "Anthropic",
  provider: null,
  source: null,
  status: "connected",
};

const connections: ProvidersSectionViewProps["connections"] = [
  anthropic,
  {
    id: "conn-openai",
    name: "Team OpenAI key",
    provider: "OpenAI",
    source: "From the server's keys.",
    status: "refused",
  },
  {
    id: "conn-google",
    name: "Google",
    provider: null,
    source: null,
    status: "unavailable",
  },
  {
    id: "conn-office-vllm",
    endpoint: (
      <CustomProviderRowView
        id="custom-office-vllm"
        name="Office vLLM"
        hint="OpenAI Chat Completions"
        modelCount={1}
        models={
          <CustomProviderModelsView
            models={[
              {
                id: "qwen3-coder-32b",
                label: "Qwen3 Coder",
                contextWindow: "131072",
                maxOutputTokens: "8192",
                fixed: true,
              },
            ]}
            duplicateIds={false}
            saveState={null}
            onModelChange={fn()}
            onModelCommit={fn()}
            onRemoveModel={fn()}
            onAddModel={fn()}
          />
        }
        editable
        removing={false}
        onEdit={fn()}
        onRemove={fn()}
        editor={null}
      />
    ),
  },
];

const meta = {
  title: "Screens/Settings/Providers",
  component: ProvidersSectionView,
  args: {
    loading: false,
    fault: null,
    logins,
    signingIn: null,
    onSignIn: fn(),
    connections: [],
    onAdd: fn(),
    addDialog: null,
  },
} satisfies Meta<typeof ProvidersSectionView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is connected: the logins wait, and the key providers offer to connect the first. */
export const NothingConnected: Story = {};

/** Until the providers are read there is neither a row nor an offer. */
export const Loading: Story = {
  args: { loading: true, logins: [] },
};

export const SomeConnected: Story = {
  args: {
    logins: [{ id: "codex", name: "ChatGPT", connected: true }, xai],
    connections,
  },
};

/** A hub with no subscription logins: the key providers are the whole section. */
export const KeyProvidersOnly: Story = {
  args: { logins: [], connections: [anthropic] },
};

/** A sign-in is open in the provider's tab; every button waits for it. */
export const SigningIn: Story = {
  args: { signingIn: "codex", connections: [anthropic] },
};

/** The providers could not be read at all. */
export const CatalogFailed: Story = {
  args: { fault: "The server did not answer. Try again.", logins: [] },
};

/** A later read failed; what the last one found stays under the banner. */
export const CatalogFailedAfterARead: Story = {
  args: { fault: "The server did not answer. Try again.", connections },
};

export const AddingProvider: Story = {
  args: {
    connections: [anthropic],
    addDialog: (
      <AddProviderDialogView
        open
        onOpenChange={fn()}
        fault={null}
        step={{
          kind: "pick",
          choices: [
            { id: "openai", label: "OpenAI", hint: "An OpenAI API key." },
            { id: "google", label: "Google", hint: "A Gemini API key." },
          ],
          chosenId: "openai",
          onChoose: fn(),
        }}
        apiKey=""
        onApiKeyChange={fn()}
        busy={false}
        ready={false}
        onSubmit={fn()}
      />
    ),
  },
};
