/**
 * What a screen can reach in the prompt box from wherever it is drawn: the slot where Send stands,
 * the box's placeholder and what Send sends. A card waiting inside the box hands over its whole row
 * of buttons; a screen in the plugin space beside the box hands over its row and its forward action
 * alike, whichever it draws, so the box keeps the one main action.
 */
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ActionsSlot,
  PromptAction,
  PromptPlaceholder,
  PromptSend,
  type PromptTake,
} from "@corbits-builder/plugin-ui/screen-actions";

/**
 * The room already shows what the screen waiting in the box is about, such as the document it asks
 * to approve, so the box holds only the screen's decision.
 */
export const ActionOnly = createContext(false);

export type BoxPorts = {
  /** The typing row's slot, once the box has drawn it. */
  setActionsAt: (element: HTMLDivElement | null) => void;
  toRow: (buttons: ReactNode) => ReactNode;
  /** What the screen asks the words to be, while it says. */
  placeholder: string | undefined;
  setPlaceholder: (placeholder: string | undefined) => void;
  /** What takes the words Send sends, while a screen offers to. */
  take: PromptTake | undefined;
  setTake: (take: PromptTake | undefined) => void;
};

export function useBoxPorts(): BoxPorts {
  const [actionsAt, setActionsAt] = useState<HTMLDivElement | null>(null);
  const [placeholder, setPlaceholder] = useState<string>();
  const [take, setTakeState] = useState<PromptTake>();
  // A function held in state is set through an updater, or React would call it.
  const setTake = useCallback(
    (next: PromptTake | undefined) => setTakeState(() => next),
    [],
  );
  const toRow = useCallback(
    (buttons: ReactNode) =>
      actionsAt === null ? null : createPortal(buttons, actionsAt),
    [actionsAt],
  );
  return useMemo(
    () => ({ setActionsAt, toRow, placeholder, setPlaceholder, take, setTake }),
    [toRow, placeholder, take, setTake],
  );
}

/** Connects what it holds to the box: as the card waiting in it, as the screen beside it, or not. */
export function InBox({
  ports,
  as,
  children,
}: {
  ports: BoxPorts;
  as: "card" | "space" | null;
  children: ReactNode;
}) {
  const on = as !== null;
  return (
    <ActionsSlot value={on ? ports.toRow : null}>
      <PromptAction value={as === "space" ? ports.toRow : null}>
        <PromptPlaceholder value={on ? ports.setPlaceholder : null}>
          <PromptSend value={on ? ports.setTake : null}>{children}</PromptSend>
        </PromptPlaceholder>
      </PromptAction>
    </ActionsSlot>
  );
}
