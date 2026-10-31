import { ArtifactRead, DocumentWrite } from "@corbits-builder/schemas/artifact";

export const ToolRead = ArtifactRead.merge({ "part?": "number.integer > 0" });

export const readDefinition = {
  name: "read_artifact",
  description:
    "See which project documents exist, or read one.\nWith no arguments it lists: each document's artifactId, kind, title, current version, sha256, approvedVersion, the version a person approved, and openQuestionCount, the questions its current version leaves open for the person; inFlight, the writer, reviewer, coder and designer runs still open, each with its status, deployed until its first assignment arrives and running after, and each working (mid-turn) or waiting (parked for your next mail), with progress once it has acted: its turns so far, its latest tool calls as tool and target, the files it has written, and lastActivityAt; failed, the latest runs that stopped on an error, with when and why, which deliver nothing more; awaitingApproval, the kinds of filed documents whose current version waits on the person's approval; and preferenceGuidance, how the person has said they want to work.\nWith a kind or an artifactId it returns that document's content at its current version, or at the given version, with the openQuestions that version leaves for the person; a long document comes in numbered parts, and part reads the next one.",
  inputSchema: { ...ToolRead.toJsonSchema() },
};
export const writeDefinition = {
  name: "write_artifact",
  description:
    "Write the next version of the project document of one kind. The hub assigns its id, version and sha256 and returns them. Writing a version is not approval.\nopenQuestions lists each question in the document's Open questions section that the person must answer: a short id, the question as they would read it, whyItBlocks, and suggestedAnswers, your recommendation first. A version written without openQuestions leaves none open.\nOn the approaches document, approaches carries the approaches it compares, for the person to see side by side: each with a short id, its name, a one-line summary, bestFor, its pros, cons and risks as short phrases, and its effort; recommended names the id of the one you recommend.",
  inputSchema: { ...DocumentWrite.toJsonSchema() },
};
