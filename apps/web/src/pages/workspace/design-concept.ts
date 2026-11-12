/** A design concept the person compares, and the document pane tab that shows it. */
export type DesignConcept = {
  readonly label: string;
  readonly direction?: string;
  /** The filed option's design bundle, once its designer filed one. */
  readonly content?: string;
  /** When the concept's designer started, and whether it is mid-turn or parked waiting for mail. */
  readonly run?: { readonly startedAt: string; readonly working: boolean };
};

const CONCEPT_TAB = "concept:";

/** The pane tab, and the document id the conversation opens, for one concept. */
export const conceptTab = (label: string) => CONCEPT_TAB + label;
export const conceptOfTab = (id: string) =>
  id.startsWith(CONCEPT_TAB) ? id.slice(CONCEPT_TAB.length) : undefined;
