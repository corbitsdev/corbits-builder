import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";
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

// A key the person typed or connected, and whether it can be replaced with another.
const key = (replaceable: boolean) => ({ replaceable, kind: "key" }) as const;

const groups: readonly SecretGroup[] = [
  {
    id: "workspace",
    project: null,
    secrets: [
      {
        id: "secret-exa",
        label: "Exa API key",
        usedBy: { plugins: ["Exa search"], host: "api.exa.ai" },
        ...key(true),
      },
      {
        id: "secret-firecrawl",
        label: "Firecrawl API key",
        usedBy: { plugins: ["Firecrawl scrape"], host: "api.firecrawl.dev" },
        ...key(true),
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
        usedBy: { plugins: ["Context7 docs"], host: "context7.com" },
        ...key(true),
      },
      {
        id: "secret-serpapi",
        label: "serpapi",
        usedBy: null,
        ...key(false),
      },
      {
        id: "secret-server",
        label: "Your server",
        usedBy: { plugins: ["Publish"], host: "203.0.113.5" },
        ...key(false),
      },
    ],
  },
  {
    id: "project-shop",
    project: "Shop",
    secrets: [
      {
        id: "secret-hoster-server",
        label: "The key to the rented machine",
        usedBy: { plugins: ["Renter"], host: "203.0.113.7" },
        replaceable: false,
        kind: "provisioned",
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

/** Revoking the Firecrawl key is on its way to the hub, so every menu waits. */
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

/** Revoking a key Builder made for a rented server says Builder can no longer publish there. */
export const RevokeRentedServerKey: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: wording.secrets.options("The key to the rented machine"),
      }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: wording.secrets.revoke }),
    );
    await expect(
      await screen.findByRole("menuitem", {
        name: wording.secrets.confirmRevokeServer,
      }),
    ).toBeVisible();
  },
};
