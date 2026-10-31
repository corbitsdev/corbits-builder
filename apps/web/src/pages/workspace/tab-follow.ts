/**
 * Which document the reading pane shows.
 *
 * The coordinator's approval, or the document they are writing, is the tab
 * to follow. The person's last explicit choice of a tab or version holds
 * until a newer version is filed; focus moving never releases it.
 */

export type FollowDocument = {
  readonly id: string;
  readonly title: string;
  readonly filed: boolean;
};

export function followDeliverableId(
  documents: readonly FollowDocument[],
  focus: {
    readonly approvalDeliverableId?: string | null;
    /** The document whose newest version was filed while the room was open. */
    readonly filedDeliverableId?: string | null;
    readonly liveText?: string;
    readonly working?: boolean;
  },
): string | null {
  for (const id of [focus.approvalDeliverableId, focus.filedDeliverableId]) {
    if (
      id !== undefined &&
      id !== null &&
      documents.some((item) => item.id === id)
    )
      return id;
  }
  const live = focus.working === true ? (focus.liveText ?? "") : "";
  const haystack = live.toLowerCase();
  if (haystack.length > 0) {
    const mentioned = [...documents]
      .reverse()
      .find(
        (item) =>
          item.title.trim().length >= 3 &&
          haystack.includes(item.title.toLowerCase()),
      );
    if (mentioned !== undefined) return mentioned.id;
  }
  return (
    [...documents].reverse().find((item) => item.filed)?.id ??
    documents[0]?.id ??
    null
  );
}

export type DocumentChoice = {
  readonly id: string;
  /** How many versions had been filed when the person chose. */
  readonly filedCount: number;
};

/** The tab to render. The person's choice wins until a version is filed after it. */
export function shownDeliverableId(input: {
  readonly choice: DocumentChoice | null;
  readonly filedCount: number;
  readonly followId: string | null;
}): string | null {
  const { choice } = input;
  if (choice !== null && choice.filedCount === input.filedCount)
    return choice.id;
  return input.followId;
}
