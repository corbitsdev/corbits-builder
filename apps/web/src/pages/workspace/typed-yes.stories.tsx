import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Button } from "../../components.tsx";
import { TypedYesCountdown } from "./typed-yes.tsx";

const meta = {
  title: "Components/Workspace/TypedYesCountdown",
} satisfies Meta;

export default meta;

function Countdown({ onUndo }: { onUndo: () => void }) {
  // The deadline is set on mount, so the countdown starts when the story opens.
  const [held, setHeld] = useState(() => ({
    approvalId: "approval-1",
    message: "yes",
    endsAt: Date.now() + 5_000,
  }));
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
      <TypedYesCountdown held={held} onUndo={onUndo} />
      <Button onClick={() => setHeld({ ...held, endsAt: Date.now() + 5_000 })}>
        Restart
      </Button>
    </div>
  );
}

export const Counting: StoryObj<{ onUndo: () => void }> = {
  args: { onUndo: fn() },
  render: (args) => <Countdown onUndo={args.onUndo} />,
};
