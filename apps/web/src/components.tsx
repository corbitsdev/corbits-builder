import { type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button as UiButton,
  Select,
  StatusDot,
  type StatusDotTone,
} from "@corbits/react-ui";
import corbitsMark from "./assets/corbits-mark.svg";

type Tone =
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

/** A state beside other text, without a badge: a dot and the word that names it. */
export function QuietState({
  tone = "info",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const mapped = STATE_TONES[tone];
  return (
    <span className="quiet-state">
      <StatusDot
        label=""
        tone={mapped.dot}
        size="sm"
        live={tone === "loading"}
      />
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

export function Banner({
  tone = "warning",
  title,
  action,
  children,
}: {
  tone?: "warning" | "error" | "okay";
  title: string;
  /**
   * The way out. A failure with an obvious next move should offer it here
   * rather than describe it and leave the person to find the screen.
   */
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <div
      className={`banner${tone === "error" ? " is-error" : tone === "okay" ? " is-okay" : ""}`}
      role="status"
    >
      <p className="banner-title">{title}</p>
      {/* A div, not a p: banners can carry block children, such as a form,
          and a form inside a p is invalid HTML. */}
      {children ? <div className="banner-body">{children}</div> : null}
      {action ? (
        <div className="banner-action">
          <Button onClick={action.onClick}>{action.label}</Button>
        </div>
      ) : null}
    </div>
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

export type NoticeAction = { label: string; onClick: () => void };

/** A finished action's result; one that did only part of its work is not shown as a success. */
export function notify(
  message: string,
  complete = true,
  action?: NoticeAction,
): void {
  const options = action ? { action } : undefined;
  if (complete) toast.success(message, options);
  else toast(message, options);
}

/** The one look for a select or a menu trigger: borderless text that underlines on hover. */
export const QUIET_CONTROL = "quiet-control";

export function QuietSelect({
  className,
  ...props
}: ComponentProps<typeof Select>) {
  return (
    <Select
      {...props}
      className={className ? `${QUIET_CONTROL} ${className}` : QUIET_CONTROL}
    />
  );
}
