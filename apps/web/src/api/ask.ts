import type { Wait } from "./types.ts";

/** What an ask asks, from its native tool name and arguments, as the decision card reads it. */
export function askOf(
  toolName: string | undefined,
  args: Record<string, unknown>,
): Pick<
  Wait,
  "toolName" | "packages" | "concepts" | "instruction" | "subject" | "kinds"
> {
  const packages = args["packages"];
  const kinds = args["kinds"];
  const instruction = args["instruction"];
  const subject = Object.values(args).find(
    (value) => typeof value === "string",
  );
  const concepts = args["concepts"];
  const designConcepts =
    Array.isArray(concepts) &&
    concepts.every(
      (item: { label?: unknown; direction?: unknown } | null) =>
        typeof item?.label === "string" && typeof item.direction === "string",
    )
      ? (concepts as { label: string; direction: string }[])
      : undefined;
  const installs =
    Array.isArray(packages) &&
    packages.every((item) => typeof item === "string")
      ? (packages as string[])
      : undefined;
  return {
    ...(toolName === undefined ? {} : { toolName }),
    ...(installs === undefined ? {} : { packages: installs }),
    ...(designConcepts === undefined ? {} : { concepts: designConcepts }),
    ...(typeof instruction === "string" ? { instruction } : {}),
    ...(typeof subject === "string" ? { subject } : {}),
    ...(Array.isArray(kinds) && kinds.every((item) => typeof item === "string")
      ? { kinds: kinds as string[] }
      : {}),
  };
}
