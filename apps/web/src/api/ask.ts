import { type } from "arktype";
import type { Wait } from "./types.ts";

const Names = type("string[]");

/** What an ask asks, from its native tool name and arguments, as the decision card reads it. */
export function askOf(
  toolName: string | undefined,
  args: Record<string, unknown>,
): Pick<Wait, "toolName" | "packages" | "subject"> {
  const subject = Object.values(args).find(
    (value) => typeof value === "string",
  );
  const installs = Names(args["packages"]);
  return {
    ...(toolName === undefined ? {} : { toolName }),
    ...(installs instanceof type.errors ? {} : { packages: installs }),
    ...(typeof subject === "string" ? { subject } : {}),
  };
}
