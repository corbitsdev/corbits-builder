import { type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  Badge,
  Button as UiButton,
  Select,
  StatusDot,
  type StatusDotTone,
} from "@corbits/react-ui";
import { MenuItem } from "@corbits/react-ui/ui/menu";
import corbitsMark from "./assets/corbits-mark.svg";
import { wording } from "./config.ts";
import styles from "./components.module.css";

export type Tone =
  | "success"
  | "okay"
  | "warning"
  | "error"
  | "selected"
  | "info"
  | "loading"
  | "disabled";

const STATE_TONES: Record<
  Tone,
  { badge: "neutral" | "success" | "warning" | "danger"; dot: StatusDotTone }
> = {
  success: { badge: "success", dot: "success" },
  okay: { badge: "success", dot: "success" },
  warning: { badge: "warning", dot: "warning" },
  error: { badge: "danger", dot: "danger" },
  selected: { badge: "neutral", dot: "emphasis" },
  info: { badge: "neutral", dot: "neutral" },
  loading: { badge: "neutral", dot: "emphasis" },
  disabled: { badge: "neutral", dot: "neutral" },
};

/**
 * A state, in the system's own vocabulary: a badge that names it and a dot
 * that marks it. Colour is paired with words, always — a reader who cannot see
 * the hue still reads the state.
 */
export function StateLabel({
  tone = "info",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const mapped = STATE_TONES[tone];
  return (
    <Badge tone={mapped.badge}>
      <StatusDot
        label=""
        tone={mapped.dot}
        size="xs"
        live={tone === "loading"}
      />
      {children}
    </Badge>
  );
}

/**
 * A state beside other text, without a badge: a dot and the word that names it.
 * Where a row of states would be a row of dots, the words alone carry the tone.
 */
export function QuietState({
  tone = "info",
  dot = true,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  const mapped = STATE_TONES[tone];
  return (
    <span
      className={styles.quietState}
      data-slot="quiet-state"
      data-tone={tone}
      data-words={dot ? undefined : ""}
    >
      {dot ? (
        <StatusDot
          label=""
          tone={mapped.dot}
          size="sm"
          live={tone === "loading"}
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * The library's button, with the two affordances this app adds.
 *
 * `loading` and `block` are ours; everything about how a button looks, presses
 * and disables is the design system's.
 */
export function Button({
  variant = "outline",
  loading = false,
  disabled = false,
  block = false,
  onClick,
  children,
  type = "button",
  ...rest
}: {
  variant?:
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "link"
    | "destructive";
  loading?: boolean;
  disabled?: boolean;
  /** Fills its container — for the single action that owns a screen. */
  block?: boolean;
  onClick?: () => void;
  children: ReactNode;
  type?: "button" | "submit";
  /** Why the control is disabled, or what it does, on hover. */
  title?: string;
  /** A control that opens and closes a panel says so. */
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  const inert = disabled || loading;
  return (
    <UiButton
      type={type}
      variant={variant}
      className={block ? "w-full" : undefined}
      disabled={inert}
      aria-busy={loading}
      onClick={inert ? undefined : onClick}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </UiButton>
  );
}

/**
 * Something about the whole surface that the person should know before going on. A failure with
 * an obvious next move offers it in a `BannerAction` rather than describing it.
 */
export function Banner({
  tone = "warning",
  role = "status",
  title,
  children,
}: {
  tone?: "warning" | "error" | "okay";
  /** An alert interrupts a screen reader; a status waits its turn. */
  role?: "status" | "alert";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={styles.banner}
      data-slot="banner"
      data-tone={tone}
      role={role}
    >
      <p className={styles.bannerTitle}>{title}</p>
      {/* A div, not a p: banners can carry block children, such as a form,
          and a form inside a p is invalid HTML. */}
      {children ? <div className={styles.bannerBody}>{children}</div> : null}
    </div>
  );
}

/** The way out of a banner, under its words. */
export function BannerAction({ children }: { children: ReactNode }) {
  return (
    <div className={styles.bannerAction} data-slot="banner-action">
      {children}
    </div>
  );
}

/** A short status or explanation in supporting text, beside or under what it is about. */
export function InlineNote({
  as: Tag = "p",
  pill = false,
  role,
  children,
}: {
  /** A span sits within a line of other text rather than a paragraph of its own. */
  as?: "p" | "span";
  /** A note that labels a view, such as which version it shows, in a rounded chip. */
  pill?: boolean;
  role?: "status";
  children: ReactNode;
}) {
  return (
    <Tag
      className={styles.inlineNote}
      data-slot="inline-note"
      data-pill={pill ? "" : undefined}
      role={role}
    >
      {children}
    </Tag>
  );
}

/**
 * What went wrong, where it went wrong, with the way to try again when there is one. Read aloud
 * as soon as it appears.
 */
export function Fault({
  onRetry,
  children,
}: {
  onRetry?: (() => void) | undefined;
  children: ReactNode;
}) {
  if (onRetry === undefined)
    return (
      <p className={styles.fault} data-slot="fault" role="alert">
        {children}
      </p>
    );
  return (
    <div className={styles.fault} data-slot="fault" role="alert">
      <p>{children}</p>
      <UiButton size="sm" variant="outline" onClick={onRetry}>
        {wording.action.retry}
      </UiButton>
    </div>
  );
}

/** A label stacked above the control it names. */
export function Field({ children }: { children: ReactNode }) {
  return (
    <div className={styles.field} data-slot="field">
      {children}
    </div>
  );
}

/** A menu item that destroys or removes something, in the destructive colour. */
export function DangerMenuItem(
  props: Omit<ComponentProps<typeof MenuItem>, "className">,
) {
  return <MenuItem {...props} className={styles.danger} />;
}

/** A menu item's words with something that belongs beside them, such as a version's date. */
export function MenuItemLabel({ children }: { children: ReactNode }) {
  return (
    <span className={styles.menuItemLabel} data-slot="menu-item-label">
      {children}
    </span>
  );
}

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <img
      src={corbitsMark}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    />
  );
}

/** The one look for a select or a small action among words: borderless text that underlines on hover. */
export function QuietSelect(
  props: Omit<ComponentProps<typeof Select>, "className">,
) {
  return (
    <Select
      {...props}
      className={styles.quietControl}
      data-slot="quiet-control"
    />
  );
}

export function QuietButton(
  props: Omit<ComponentProps<"button">, "className" | "type">,
) {
  return (
    <button
      type="button"
      {...props}
      className={styles.quietControl}
      data-slot="quiet-control"
    />
  );
}
