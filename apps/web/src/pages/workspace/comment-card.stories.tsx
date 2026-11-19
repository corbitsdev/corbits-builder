import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, waitFor } from "storybook/test";
import { Button } from "../../components.tsx";
import { wording } from "../../config.ts";
import { CommentCard, type CommentState } from "./comment-card.tsx";

const text = wording.comments;

const meta = {
  title: "Components/Workspace/Comments/CommentCard",
  component: CommentCard,
  args: {
    state: "saved",
    comment: "Mention text and walk-in orders too",
    version: 3,
    onSave: fn(),
    onCancel: fn(),
    onEdit: fn(),
    onDelete: fn(),
    onResolve: fn(),
  },
} satisfies Meta<typeof CommentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens level with the passage, ready to type; Enter saves it. */
export const Writing: Story = { args: { state: "writing" } };

/** A new comment starts empty, and its send waits for words. */
export const WritingEmpty: Story = { args: { state: "writing", comment: "" } };

/** Waits for the others; nothing is sent yet. */
export const Saved: Story = {};

/** The change is being made: moving dots on the line beneath, the words in grey. */
export const BeingMade: Story = { args: { state: "making" } };

/** Names the version that has the change; the tick clears it. */
export const Changed: Story = { args: { state: "changed" } };

/** A long comment wraps inside the card. */
export const LongComment: Story = {
  args: {
    comment:
      "Some regulars text their order to the counter, and a few walk in and order at the till. Should both of those count as orders too, and land in the same list as the phone ones? Otherwise a Saturday still has three places to check.",
  },
};

/** A long draft grows the field a line at a time, then scrolls. */
export const LongDraft: Story = {
  args: {
    state: "writing",
    comment:
      "Some regulars text their order to the counter, and a few walk in and order at the till. Should both of those count as orders too, and land in the same list as the phone ones? Otherwise a Saturday still has three places to check, and the counter staff are the ones who have to.",
  },
};

/** The save is on its way. */
export const Saving: Story = { args: { state: "writing", saving: true } };

/** The save did not land: the words stay, and the send tries again. */
export const SaveFailed: Story = {
  args: { state: "writing", saveFailed: true },
};

/** Enter saves the comment; Shift+Enter starts a new line instead. */
export const EnterSaves: Story = {
  args: { state: "writing", comment: "" },
  play: async ({ args, canvas, userEvent }) => {
    const field = canvas.getByRole("textbox", { name: text.field });
    await userEvent.click(field);
    await userEvent.keyboard("Mention text orders{Shift>}{Enter}{/Shift}");
    await expect(args.onSave).not.toHaveBeenCalled();
    await userEvent.keyboard("and walk-in{Enter}");
    await expect(args.onSave).toHaveBeenCalledWith(
      "Mention text orders\nand walk-in",
    );
  },
};

/** Escape leaves the comment without saving it. */
export const EscapeCancels: Story = {
  args: { state: "writing" },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("textbox", { name: text.field }));
    await userEvent.keyboard("{Escape}");
    await expect(args.onCancel).toHaveBeenCalled();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** Tab reaches edit and delete, which show with the focus ring. */
export const KeyboardFocus: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: text.edit })).toHaveFocus();
  },
};

/** The tick on a changed comment, reached by keyboard. */
export const ResolveFocus: Story = {
  args: { state: "changed" },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    const resolve = canvas.getByRole("button", { name: text.resolve });
    await expect(resolve).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    // The card fades out before it hands over.
    await waitFor(() => expect(args.onResolve).toHaveBeenCalled());
  },
};

/** Write, save, edit and delete in one card. */
export const Interactive: Story = {
  render: function Render(args) {
    const [state, setState] = useState<CommentState | null>("writing");
    const [comment, setComment] = useState("");
    if (state === null)
      return (
        <Button onClick={() => setState("writing")}>{text.placeholder}</Button>
      );
    return (
      <CommentCard
        {...args}
        state={state}
        comment={comment}
        onSave={(words) => {
          setComment(words);
          setState("saved");
        }}
        onCancel={() => setState(comment === "" ? null : "saved")}
        onEdit={() => setState("writing")}
        onDelete={() => setState(null)}
      />
    );
  },
};

/** Every state beside the next, as the board lays them out. */
export const AllStates: Story = {
  render: ({ version = 3, ...args }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, 17.5rem)",
        gap: 32,
        alignItems: "start",
      }}
    >
      <CommentCard {...args} state="writing" />
      <CommentCard {...args} state="saved" />
      <CommentCard {...args} state="saved" paired />
      <CommentCard {...args} state="making" />
      <CommentCard {...args} state="changed" version={version} />
      <CommentCard {...args} state="changed" />
    </div>
  ),
};
