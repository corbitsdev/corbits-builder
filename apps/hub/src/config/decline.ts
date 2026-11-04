// Interchange answers a declined call with "denied by approver: " and the decline's message. The
// hub writes that message for the coordinator's asks, so it reads the person's answer rather than
// a failed call.
const DECLINE_LEAD = "The person has chosen to decline this tool call.";
const FEEDBACK_LEAD = DECLINE_LEAD + "\n\nTheir feedback is: ";
const NO_FEEDBACK =
  DECLINE_LEAD +
  " They left no feedback. Ask them what they would like to do next.";

/** The message a coordinator ask's decline carries, around the person's words when they gave some. */
export function declineNote(words: string | undefined): string {
  const said = words?.trim();
  return said === undefined || said === "" ? NO_FEEDBACK : FEEDBACK_LEAD + said;
}

/** The person's own words in a decline's message: none for a bare decline, all of a message the hub did not write. */
export function declinedWords(message: string | undefined): string | undefined {
  if (message === undefined || message === NO_FEEDBACK) return undefined;
  return message.startsWith(FEEDBACK_LEAD)
    ? message.slice(FEEDBACK_LEAD.length)
    : message;
}
