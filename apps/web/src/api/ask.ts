import { type } from "arktype";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import {
  ASK_QUESTIONS,
  AskQuestions,
} from "@corbits-builder/schemas/questions";
import type { Wait } from "./types.ts";

const Names = type("string[]");

/** What an ask asks, from its native tool name and arguments, as the decision card reads it. */
export function askOf(
  toolName: string | undefined,
  args: Record<string, unknown>,
): Pick<
  Wait,
  | "toolName"
  | "packages"
  | "concepts"
  | "instruction"
  | "subject"
  | "kinds"
  | "questions"
> {
  const packages = args["packages"];
  const listed = Names(args["kinds"]);
  const instruction = args["instruction"];
  const subject = Object.values(args).find(
    (value) => typeof value === "string",
  );
  const concepts = DesignConcept.array()(args["concepts"]);
  const designConcepts = concepts instanceof type.errors ? undefined : concepts;
  const installs = Names(packages);
  // Questions in the shape the card draws; the hub refuses any other before the call waits.
  const questions =
    toolName === ASK_QUESTIONS && AskQuestions.allows(args) ? args : undefined;
  return {
    ...(toolName === undefined ? {} : { toolName }),
    ...(installs instanceof type.errors ? {} : { packages: installs }),
    ...(designConcepts === undefined ? {} : { concepts: designConcepts }),
    ...(typeof instruction === "string" ? { instruction } : {}),
    ...(typeof subject === "string" ? { subject } : {}),
    ...(listed instanceof type.errors ? {} : { kinds: listed }),
    ...(questions === undefined ? {} : { questions }),
  };
}
