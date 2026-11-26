/**
 * What every part of the room reads about the session it is in, and the ways back into the room.
 * The room makes one, so the prompt box, the comments and the sidebar agree on which project this
 * is and which tab is on the page.
 */
export type RoomSession = {
  projectId: string;
  archived: boolean;
  /** The project view fills the window. */
  projectOpen: boolean;
  /** The project view tab on the page; null while the chat fills the room. */
  shown: string | null;
  /** Opens the project view on a tab, such as a document by the room's key for it. */
  openTab: (tab: string) => void;
  /** Sends a message as the person, such as asking to try again. */
  send: (message: string) => void;
  /** Reads the room again from the hub. */
  reload: () => void;
};
