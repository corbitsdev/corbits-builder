import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../../components.tsx";
import {
  SettingsInput,
  SettingsRow,
  SettingsRowValue,
} from "./settings-row.tsx";
import { SettingsSectionBody, SettingsSubhead } from "./settings-section.tsx";

const meta = {
  title: "Components/Settings/SettingsRow",
  component: SettingsRow,
  args: {
    label: "Theme",
    hint: "How Builder looks on this device.",
    children: <SettingsInput aria-label="Theme" defaultValue="System" />,
  },
} satisfies Meta<typeof SettingsRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Row: Story = {};

/** A row the person was sent to, marked until the highlight fades. */
export const Highlighted: Story = { args: { highlighted: true } };

/** A section's rows with a subhead, a lead, a value column and a bare action row. */
export const Section: Story = {
  render: () => (
    <SettingsSectionBody>
      <SettingsSubhead>Open source</SettingsSubhead>
      <p>Builder is made with these projects.</p>
      <SettingsRow label="react" hint="Interface">
        <SettingsRowValue>
          MIT <a href="https://react.dev">License</a>
        </SettingsRowValue>
      </SettingsRow>
      <SettingsRow label="Model columns">
        <SettingsRowValue>
          <SettingsInput size="token" aria-label="Context window" />
          <SettingsInput size="token" aria-label="Max output" />
        </SettingsRowValue>
      </SettingsRow>
      <SettingsRow>
        <Button variant="outline">Sign out</Button>
      </SettingsRow>
    </SettingsSectionBody>
  ),
};
