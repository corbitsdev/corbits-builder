import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn, screen, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  SecretsSectionView,
  type SecretGroup,
  type SecretsSectionViewProps,
} from "./secrets.view.tsx";

// Holds what the section asks its host to keep: which secret's key is being replaced.
function Host(args: SecretsSectionViewProps) {
  const [replacing, setReplacing] = useState(args.replacing);
  return (
    <SecretsSectionView
      {...args}
      replacing={replacing}
      onReplacing={(id) =>
        setReplacing(id === null ? null : { id, refused: null })
      }
    />
  );
}

const groups: readonly SecretGroup[] = [
  {
    id: "workspace",
    project: null,
    secrets: [
      {
        id: "secret-exa",
        label: "Exa API key",
        plugins: ["Exa search"],
        host: "api.exa.ai",
      },
      {
        id: "secret-firecrawl",
        label: "Firecrawl API key",
        plugins: ["Firecrawl scrape"],
        host: "api.firecrawl.dev",
      },
    ],
  },
  {
    id: "project-habit-tracker",
    project: "Habit tracker",
    secrets: [
      {
        id: "secret-context7",
        label: "Context7 API key",
        plugins: ["Context7 docs"],
        host: "context7.com",
      },
      {
        id: "secret-serpapi",
        label: "SerpApi key",
        plugins: [],
        host: "serpapi.com",
      },
    ],
  },
];

const meta = {
  title: "Screens/Settings/Secrets",
  component: SecretsSectionView,
  args: {
    loading: false,
    fault: null,
    groups,
    pending: null,
    replacing: null,
    onReplacing: fn(),
    onReplace: fn(),
    onRevoke: fn(),
  },
  render: (args) => <Host {...args} />,
} satisfies Meta<typeof SecretsSectionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { groups: [] },
};

/** Until the secrets are read there is neither a row nor the empty state. */
export const Loading: Story = {
  args: { loading: true, groups: [] },
};

/** A later read failed; what the last one found stays under the banner. */
export const ReadFailed: Story = {
  args: { fault: "The server did not answer. Try again." },
};

/** Revoking the Firecrawl key is on its way to the hub, so its menu waits. */
export const Revoking: Story = {
  args: { pending: "secret-firecrawl" },
};

/** The Exa key's menu was opened and Replace picked, so a field takes its row. */
export const ReplaceForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: wording.secrets.options("Exa API key"),
      }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: wording.secrets.replace }),
    );
  },
};

/** The new Exa key is on its way to the hub; the form stays until it is saved. */
export const ReplaceSaving: Story = {
  args: {
    pending: "secret-exa",
    replacing: { id: "secret-exa", refused: null },
  },
};

/** Exa refused the key that was tried, so the form stays open to try another. */
export const ReplaceRefused: Story = {
  args: {
    replacing: { id: "secret-exa", refused: "Refused this key." },
  },
};
