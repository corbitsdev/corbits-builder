import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProviderLogo } from "./provider-logos.tsx";

const PROVIDERS = ["openai", "anthropic", "google", "xai", "custom"] as const;

const meta = {
  title: "Components/ProviderLogo",
  component: ProviderLogo,
  args: { providerId: "anthropic" },
  argTypes: { providerId: { control: "select", options: PROVIDERS } },
  decorators: [
    (Story) => (
      <span style={{ display: "inline-flex", width: 24, height: 24 }}>
        <Story />
      </span>
    ),
  ],
} satisfies Meta<typeof ProviderLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Logo: Story = {};

/** A provider without a mark gets a neutral plug. */
export const All: Story = {
  decorators: [],
  render: () => (
    <div style={{ display: "flex", gap: 16 }}>
      {PROVIDERS.map((id) => (
        <span
          key={id}
          title={id}
          style={{ display: "inline-flex", width: 24, height: 24 }}
        >
          <ProviderLogo providerId={id} />
        </span>
      ))}
    </div>
  ),
};
