import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { checkInput } from "@corbits-builder/plugin";
import pickFonts from "@corbits-builder/designer-plugin/pick-fonts";
import fonts from "@corbits-builder/designer-plugin/pick-fonts/data";
import { Fonts } from "@corbits-builder/designer-plugin/pick-fonts/schema";
import {
  FontPicker,
  text,
} from "@corbits-builder/designer-plugin/pick-fonts/view";

const prepare = (
  input: Record<string, unknown>,
  project: Record<string, string>,
) => {
  const checked = checkInput(
    "designer pick-fonts",
    pickFonts,
    input,
    Fonts.assert(fonts),
    project,
  );
  if (!checked.ok || checked.prepared === undefined)
    throw new Error("The font picker's own fonts do not prepare.");
  return { input: checked.input, project, prepared: checked.prepared };
};

const inList = {
  "look.font-primary": "Inter",
  "look.font-secondary": "JetBrains Mono",
};
const browsing = prepare({}, inList);
const font = (name: string) => {
  const found = browsing.prepared.fonts.find((each) => each.name === name);
  if (found === undefined) throw new Error(`${name} is not offered.`);
  return found;
};

// Keeps the draft the way the conversation does, so a story can be clicked through.
function Drafting(props: ComponentProps<typeof FontPicker>) {
  const [draft, setDraft] = useState(props.draft);
  return (
    <FontPicker
      input={props.input}
      project={props.project}
      prepared={props.prepared}
      facts={props.facts}
      draft={draft}
      setDraft={(change) => {
        props.setDraft(change);
        setDraft((current) => Object.assign({}, current, change));
      }}
      submit={props.submit}
      submitting={props.submitting}
      answer={props.answer}
    />
  );
}

const meta = {
  title: "Screens/Workspace/FontPicker",
  component: FontPicker,
  render: (args) => <Drafting {...args} />,
  args: {
    input: browsing.input,
    project: browsing.project,
    prepared: browsing.prepared,
    facts: [],
    draft: {},
    setDraft: fn(),
    submit: fn(() => Promise.resolve()),
    submitting: false,
    answer: undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FontPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both fonts in use are in the list: the primary is changed and saved with the secondary kept. */
export const Browsing: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText(text.unchanged)).toBeVisible();
    await userEvent.type(canvas.getByRole("combobox"), "fra");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await userEvent.click(canvas.getByRole("button", { name: text.save }));
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Fraunces"),
      secondary: font("JetBrains Mono"),
    });
  },
};

const notInList = prepare(
  {},
  { "look.font-primary": "Red Hat Display", "look.font-secondary": "Inter" },
);

/** The primary in use is not in the list: its stored name shows and Save waits until it is picked. */
export const NotInList: Story = {
  args: {
    input: notInList.input,
    project: notInList.project,
    prepared: notInList.prepared,
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      canvas.getByText(text.inUseNamed("Red Hat Display")),
    ).toBeVisible();
    const save = canvas.getByRole("button", { name: text.save });
    await expect(save).toBeDisabled();
    await expect(canvas.getByText(text.missing("primary"))).toBeVisible();
    await userEvent.type(canvas.getByRole("combobox"), "fraunces");
    await userEvent.keyboard("{Enter}");
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Fraunces"),
      secondary: font("Inter"),
    });
  },
};

const proposal = prepare({ proposed: { primary: "Fraunces" } }, inList);
const proposalArgs = {
  input: proposal.input,
  project: proposal.project,
  prepared: proposal.prepared,
};

/** A proposal shows the font in use beside it; using it keeps the secondary in use. */
export const Proposal: Story = {
  args: proposalArgs,
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText(text.inUseNamed("Inter"))).toBeVisible();
    await expect(
      canvas.getByText(text.proposedNamed("Fraunces")),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: text.useProposed }),
    );
    await expect(args.submit).toHaveBeenCalledWith({
      primary: font("Fraunces"),
      secondary: font("JetBrains Mono"),
    });
  },
};

/** "Choose something else" leaves the proposal for the list. */
export const ProposalDeclined: Story = {
  args: proposalArgs,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: text.chooseOther }),
    );
    await expect(canvas.getByRole("combobox")).toBeVisible();
  },
};

export const Settled: Story = {
  args: {
    answer: { primary: font("Fraunces"), secondary: font("JetBrains Mono") },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Primary: Fraunces. Secondary: JetBrains Mono."),
    ).toBeVisible();
  },
};
