import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn } from "storybook/test";
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
    onSave: fn(),
    onCancel: fn(),
    onEdit: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof CommentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens level with the passage, ready to type; Enter saves it. */
export const Writing: Story = { args: { state: "writing" } };

/** A new comment starts empty, and its send waits for words. */
export const WritingEmpty: Story = { args: { state: "writing", comment: "" } };

/** A draft that waits for the others; it can be edited or deleted until it is sent. */
export const Saved: Story = {};

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
  render: (args) => (
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
    </div>
  ),
};
