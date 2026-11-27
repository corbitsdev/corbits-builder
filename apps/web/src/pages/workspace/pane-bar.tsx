/**
 * The document pane's one control bar, heading a written page or standing up the edge of one that
 * fills the pane. Each view passes its own groups of actions; the
 * bar draws them as quiet buttons with a rule between groups, so every view's controls sit in
 * the same place and look the same.
 */
import { Button } from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useRef, type ReactNode, type Ref } from "react";
import { MenuItemLabel } from "../../components.tsx";
import { wording } from "../../config.ts";
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";
import styles from "./pane-bar.module.css";

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
  upright,
}: {
  label: string;
  actions: readonly PaneBarAction[];
  upright: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const pressed = actions.findIndex((item) => item.active);
  // The pressed chip is kept in sight along the strip, across or down as the bar runs.
  useEffect(() => {
    const strip = row.current;
    const chip = strip?.children[pressed] as HTMLElement | undefined;
    if (strip === null || chip === undefined) return;
    const [start, size, scroll, view] = upright
      ? ([
          chip.offsetTop,
          chip.offsetHeight,
          strip.scrollTop,
          strip.clientHeight,
        ] as const)
      : ([
          chip.offsetLeft,
          chip.offsetWidth,
          strip.scrollLeft,
          strip.clientWidth,
        ] as const);
    const to =
      start < scroll
        ? start
        : start + size > scroll + view
          ? start + size - view
          : null;
    if (to === null) return;
    if (upright) strip.scrollTop = to;
    else strip.scrollLeft = to;
  }, [pressed, actions.length, upright]);
  return (
    <div ref={row} className={styles.row} role="group" aria-label={label}>
      {actions.map((item) => (
        <ActionButton key={item.id} action={item} upright={upright} />
      ))}
    </div>
  );
}

function ActionButton({
  action,
  upright,
}: {
  action: PaneBarAction;
  /** In a bar standing up the window's edge, whose menus open beside it rather than above. */
  upright: boolean;
}) {
  // Standing up the edge, a strip of words would stack into a column of uneven chips, so it is
  // drawn as one button with the others in its menu: the strip's own icon where it has one, as
  // its neighbours are, or else the pressed one's words.
  if (action.row && upright && action.row.some((item) => item.text)) {
    const pressed = action.row.find((item) => item.active);
    return (
      <ActionButton
        upright
        action={{
          id: action.id,
          label: action.label,
          ...(action.icon === undefined
            ? {
                text: pressed?.text ?? action.label,
                icon: <ChevronDown size={12} aria-hidden="true" />,
              }
            : { icon: action.icon }),
          menu: action.row.map((item) => (
            <MenuItem
              key={item.id}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              <MenuItemLabel>
                {item.text ?? item.label}
                {item.active ? <Check size={14} aria-label="Shown" /> : null}
              </MenuItemLabel>
            </MenuItem>
          )),
        }}
      />
    );
  }
  if (action.row)
    return (
      <ActionRow label={action.label} actions={action.row} upright={upright} />
    );
  // Standing up the window's edge, a note with an icon keeps to it so a line of text never widens
  // the strip; pressing the icon shows its words, so they are never only on hover.
  if (
    upright &&
    action.note === true &&
    action.icon !== undefined &&
    action.text !== undefined
  ) {
    const { text, note: _note, ...rest } = action;
    return (
      <ActionButton
        action={{ ...rest, menu: <PaneBarTip>{text}</PaneBarTip> }}
        upright
      />
    );
  }
  const words = action.text === undefined ? null : <span>{action.text}</span>;
  if (action.note)
    return (
      <span
        className={styles.note}
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
      className={styles.action}
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
      <MenuContent align="center" side={upright ? "left" : "top"}>
        {action.menu}
      </MenuContent>
    </Menu>
  );
}

/** A short note a bar action's menu shows as words rather than items. */
export function PaneBarTip({ children }: { children: ReactNode }) {
  return (
    <MenuLabel className={styles.tip} data-slot="pane-bar-tip">
      {children}
    </MenuLabel>
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
  /** Stands up the right edge of a page that fills the pane, and can be folded to a small handle. */
  floating?: boolean;
  /** A panel an action opens just above the bar; passing it, even as null, anchors the bar. */
  popover?: ReactNode;
  /** The anchor around the bar and its popover, so a press on either stays inside it. */
  popoverRef?: Ref<HTMLDivElement> | undefined;
}) {
  const folded =
    useStoredPreference(FLOATING_KEY, parseFloating, "shown") === "hidden";
  const shown = groups.filter((group) => group.length > 0);
  if (shown.length === 0) return null;
  const bar =
    floating && folded ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles.handle}
        data-slot="pane-bar-handle"
        aria-label={wording.paneBar.show}
        title={wording.paneBar.show}
        onClick={() => writeStoredPreference(FLOATING_KEY, "shown")}
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </Button>
    ) : (
      <div
        className={styles.bar}
        data-slot="pane-bar"
        data-floating={floating ? "" : undefined}
        role="toolbar"
        aria-label={label}
      >
        {shown.map((group, index) => (
          <Fragment key={group.map((action) => action.id).join(" ")}>
            {index > 0 ? (
              <span className={styles.rule} aria-hidden="true" />
            ) : null}
            {group.map((action) => (
              <ActionButton
                key={action.id}
                action={action}
                upright={floating}
              />
            ))}
          </Fragment>
        ))}
        {floating ? (
          <>
            <span className={styles.rule} aria-hidden="true" />
            <ActionButton
              upright
              action={{
                id: "fold",
                label: wording.paneBar.hide,
                icon: <ChevronRight size={16} aria-hidden="true" />,
                onSelect: () => writeStoredPreference(FLOATING_KEY, "hidden"),
              }}
            />
          </>
        ) : null}
      </div>
    );
  if (popover === undefined) return bar;
  return (
    <div ref={popoverRef} className={styles.anchor}>
      {popover}
      {bar}
    </div>
  );
}
