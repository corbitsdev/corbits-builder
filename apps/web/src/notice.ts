import { toast } from "sonner";

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
