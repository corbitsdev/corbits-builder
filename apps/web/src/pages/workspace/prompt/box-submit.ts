/**
 * Where Send sends what is in the prompt box. The first destination that can take it does, in the
 * order below, so a pick in a screen or a comment beside the page is never lost to a plain message.
 */
export type SendTo = {
  /** Files are attached. They go out with a message, so nothing before it takes the words. */
  files: boolean;
  /** Sends the comment drafts, with any words typed; null while none can go now. */
  comments: ((words?: string) => void) | null;
  /** Answers a question the shell asked with the whole text; whether it took it. */
  shell: ((text: string) => boolean) | undefined;
  /**
   * A screen in the box, which sends the words with what is picked in it; whether it took them.
   * It takes Send with nothing typed only when it has a label of its own for Send.
   */
  screen:
    | { take: (words: string) => boolean; label: string | null }
    | undefined;
  /** Sends the words and files to the coordinator. */
  message: () => void;
};

export type Sent = "comments" | "shell" | "screen" | "message";

export function submit(text: string, to: SendTo): Sent {
  const words = text.trim();
  if (!to.files) {
    if (to.comments !== null && words === "") {
      to.comments();
      return "comments";
    }
    if (to.shell?.(text) === true) return "shell";
    if (
      to.screen !== undefined &&
      (words !== "" || to.screen.label !== null) &&
      to.screen.take(words)
    )
      return "screen";
    if (to.comments !== null) {
      to.comments(words);
      return "comments";
    }
  }
  to.message();
  return "message";
}
