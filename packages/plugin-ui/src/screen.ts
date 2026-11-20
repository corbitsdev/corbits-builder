/** The view boundary contains data and named screen actions, never room controls. */
export type ScreenViewProps<Input, Output, Prepared, Resources = unknown> = {
  prepared: {
    input: Input;
    data: Prepared;
    project: Readonly<Record<string, unknown>>;
    facts: readonly string[];
    resources: Resources;
  };
  draft: Partial<Output>;
  setDraft(
    change: Partial<Output> | ((current: Partial<Output>) => Partial<Output>),
  ): void;
  submit(output: Output): Promise<void>;
  submitting: boolean;
  fault: string | undefined;
  place: "card" | "page";
  answer: Output | undefined;
  /** Decision screens (writer approval and mockup review) offer their current answer to host controls. */
  offer?:
    | ((offer: {
        accept: { output: Output } | { unavailable: string };
        sendBack?: Output;
      }) => void)
    | undefined;
  act?:
    | ((action: string, input?: Record<string, unknown>) => Promise<void>)
    | undefined;
  /** Writer's document approval opens a filed document by kind. */
  openDocument?: ((kind: string) => void) | undefined;
};
