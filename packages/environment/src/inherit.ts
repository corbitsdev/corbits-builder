import type { RawEnvironment } from "./read.ts";

/**
 * Copies the named variables from an environment, the process's own by default, to pass to a child
 * process. What a child needs to find programs and scratch space is not configuration, so it is
 * copied without validation. Unset and empty variables are left out.
 */
export function inherit<const name extends string>(
  names: readonly name[],
  from: RawEnvironment = process.env,
): Partial<Record<name, string>> {
  const inherited: Partial<Record<name, string>> = {};
  for (const name of names) {
    const value = from[name];
    if (value) inherited[name] = value;
  }
  return inherited;
}
