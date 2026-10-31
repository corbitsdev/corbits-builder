/**
 * The document pane's one floating control bar. Each view passes its own groups of actions; the
 * bar draws them as quiet buttons with a rule between groups, so every view's controls sit in
 * the same place and look the same.
 */
import { Button } from "@corbits/react-ui";
import { Menu, MenuContent, MenuTrigger } from "@corbits/react-ui/ui/menu";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { wording } from "../../config.ts";
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";

export type PaneBarAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Visible words before the icon, for a value such as "v4" or the current screen. */
  text?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Readies what onSelect needs, as a pointer or focus reaches the action. */
  onPrepare?: () => void;
  /** Menu items; the action opens them instead of acting. */
  menu?: ReactNode;
  /** A quiet badge that says something about the view rather than acting on it. */
  note?: boolean;
  /** Actions in a strip named by the label that scrolls sideways rather than widen the bar. */
  row?: readonly PaneBarAction[];
  ref?: Ref<HTMLButtonElement>;
};

export type PaneBarGroup = readonly PaneBarAction[];

// Scrolls only the strip, never the pane, so the pressed action stays in sight as it changes.
function ActionRow({
  label,
  actions,
}: {
  label: string;
  actions: readonly PaneBarAction[];
}) {
  const row = useRef<HTMLDivElement>(null);
  const pressed = actions.findIndex((item) => item.active);
  useEffect(() => {
    const strip = row.current;
    const chip = strip?.children[pressed] as HTMLElement | undefined;
    if (strip === null || chip === undefined) return;
    if (chip.offsetLeft < strip.scrollLeft) strip.scrollLeft = chip.offsetLeft;
    else if (
      chip.offsetLeft + chip.offsetWidth >
      strip.scrollLeft + strip.clientWidth
    )
      strip.scrollLeft = chip.offsetLeft + chip.offsetWidth - strip.clientWidth;
  }, [pressed, actions.length]);
  return (
    <div ref={row} className="pane-bar-row" role="group" aria-label={label}>
      {actions.map((item) => (
        <ActionButton key={item.id} action={item} />
      ))}
    </div>
  );
}

function ActionButton({ action }: { action: PaneBarAction }) {
  const words = action.text === undefined ? null : <span>{action.text}</span>;
  if (action.row)
    return <ActionRow label={action.label} actions={action.row} />;
  if (action.note)
    return (
      <span
        className="pane-bar-note"
        role="status"
        aria-label={action.label}
        title={action.label}
      >
        {action.icon}
        {words}
      </span>
    );
  const button = (
    <Button
      ref={action.ref}
      type="button"
      variant={action.active ? "secondary" : "ghost"}
      size={words === null ? "icon" : "sm"}
      className="pane-bar-action"
      aria-label={action.label}
      title={action.label}
      disabled={action.disabled}
      {...(action.active === undefined
        ? {}
        : { "aria-pressed": action.active })}
      {...(action.menu === undefined ? { onClick: action.onSelect } : {})}
      {...(action.onPrepare === undefined
        ? {}
        : { onPointerEnter: action.onPrepare, onFocus: action.onPrepare })}
    >
      {words}
      {action.icon}
    </Button>
  );
  if (action.menu === undefined) return button;
  return (
    <Menu>
      <MenuTrigger asChild>{button}</MenuTrigger>
      <MenuContent align="center" side="top">
        {action.menu}
      </MenuContent>
    </Menu>
  );
}

// One choice for every floating bar, kept per viewer: hidden to see the whole page under it.
const FLOATING_KEY = "builder-pane-bar";
const parseFloating = (raw: string) =>
  raw === "shown" || raw === "hidden" ? raw : null;

export function PaneBar({
  label,
  groups,
  floating = false,
  popover,
  popoverRef,
}: {
  label: string;
  groups: readonly PaneBarGroup[];
  /** Floats over the foot of a page that fills the pane, and can be folded to a small handle. */
  floating?: boolean;
  /** A panel an action opens just above the bar; passing it, even as null, anchors the bar. */
  popover?: ReactNode;
  /** The anchor around the bar and its popover, so a press on either stays inside it. */
  popoverRef?: Ref<HTMLDivElement> | undefined;
}) {
  const folded =
    useStoredPreference(FLOATING_KEY, parseFloating, "shown") === "hidden";
  const [floatingBar, setFloatingBar] = useState<HTMLElement | null>(null);
  // The pane keeps its foot clear of the floating bar at whatever height the bar wraps to.
  useEffect(() => {
    const pane =
      floatingBar?.closest<HTMLElement>('[data-slot="panel-pane"]') ?? null;
    if (floatingBar === null || pane === null) return;
    const observer = new ResizeObserver(() =>
      pane.style.setProperty(
        "--pane-bar-height",
        `${String(floatingBar.offsetHeight)}px`,
      ),
    );
    observer.observe(floatingBar);
    return () => {
      observer.disconnect();
      pane.style.removeProperty("--pane-bar-height");
    };
  }, [floatingBar]);
  const shown = groups.filter((group) => group.length > 0);
  if (shown.length === 0) return null;
  const bar =
    floating && folded ? (
      <Button
        ref={setFloatingBar}
        type="button"
        variant="ghost"
        size="icon"
        className="pane-bar-handle"
        aria-label={wording.paneBar.show}
        title={wording.paneBar.show}
        onClick={() => writeStoredPreference(FLOATING_KEY, "shown")}
      >
        <ChevronUp size={14} aria-hidden="true" />
      </Button>
    ) : (
      <div
        ref={floating ? setFloatingBar : undefined}
        className={floating ? "pane-bar pane-bar-floating" : "pane-bar"}
        role="toolbar"
        aria-label={label}
      >
        {shown.map((group, index) => (
          <Fragment key={group.map((action) => action.id).join(" ")}>
            {index > 0 ? (
              <span className="pane-bar-rule" aria-hidden="true" />
            ) : null}
            {group.map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </Fragment>
        ))}
        {floating ? (
          <>
            <span className="pane-bar-rule" aria-hidden="true" />
            <ActionButton
              action={{
                id: "fold",
                label: wording.paneBar.hide,
                icon: <ChevronDown size={16} aria-hidden="true" />,
                onSelect: () => writeStoredPreference(FLOATING_KEY, "hidden"),
              }}
            />
          </>
        ) : null}
      </div>
    );
  if (popover === undefined) return bar;
  return (
    <div ref={popoverRef} className="pane-bar-anchor">
      {popover}
      {bar}
    </div>
  );
}
