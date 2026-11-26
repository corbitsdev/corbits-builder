/**
 * What covers the conversation: nothing, the project view, or a plugin's screen in the space over
 * either. The room holds only the person's last say about the screen and works out the rest here,
 * so the folded card, the chat sheet's handle and what Escape closes all read one value. Each rule
 * takes plain data and returns it, so it is tested without a page.
 */

/** A plugin screen drawn for the page, by its key, and the project view tab it shows more of. */
export type SpaceScreen = { key: string; shows: string | null };

/**
 * The person's last say about the screen: they opened it from the box, which holds until they put
 * it away; or they closed the one with this key, which holds until it opens again.
 */
export type SpaceChoice =
  | { kind: "none" }
  | { kind: "opened" }
  | { kind: "closed"; key: string };

export type Cover =
  | { kind: "chat" }
  | { kind: "project" }
  /**
   * The screen in the space, over the conversation, over the project view, or standing in for the
   * project view tab it shows more of, which closes with it.
   */
  | { kind: "space"; over: "chat" | "project" | "tab" };

export const NO_CHOICE: SpaceChoice = { kind: "none" };

/**
 * A screen covers the conversation unless the person closed it. Over the project view it waits for
 * Open in the box, unless it stands in for the tab the view shows, so the person never has the tab
 * on the page and the screen to open beside it.
 */
export function coverOf({
  projectOpen,
  space,
  choice,
  paneShown,
}: {
  projectOpen: boolean;
  space: SpaceScreen | null;
  choice: SpaceChoice;
  /** The project view tab on the page. */
  paneShown: string | null;
}): Cover {
  if (space !== null) {
    const standsIn =
      projectOpen && space.shows !== null && space.shows === paneShown;
    const closed = choice.kind === "closed" && choice.key === space.key;
    if (choice.kind === "opened" || ((!projectOpen || standsIn) && !closed))
      return {
        kind: "space",
        over: !projectOpen ? "chat" : standsIn ? "tab" : "project",
      };
  }
  return projectOpen ? { kind: "project" } : { kind: "chat" };
}

/**
 * Opening a tab from the sidebar: the tab the screen shows more of brings a closed screen back;
 * any other puts away a screen opened from the box, or the tab would open behind it.
 */
export function choiceOnTab(
  choice: SpaceChoice,
  space: SpaceScreen,
  tab: string,
): SpaceChoice {
  if (tab === space.shows) return choice.kind === "closed" ? NO_CHOICE : choice;
  return choice.kind === "opened" ? NO_CHOICE : choice;
}

/** With no screen left to show, one opened from the box is put away; a closed one stays closed. */
export const choiceOnGone = (choice: SpaceChoice): SpaceChoice =>
  choice.kind === "opened" ? NO_CHOICE : choice;
