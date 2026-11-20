import { type, type Type } from "arktype";

// What every Builder process's environment.ts reads its environment with. Each rule describes what
// it expects in words and never puts the refused value in its error, because the value can be a
// secret.

/** A TCP port, 1 to 65535. */
export const port = type("string").pipe((value, ctx) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : ctx.error("an integer between 1 and 65535");
});

/** An HTTP(S) origin with no credentials, path, query or fragment, read as its origin. */
export const origin = type("string").pipe((value, ctx) => {
  const url = URL.parse(value);
  return url &&
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
    ? url.origin
    : ctx.error(
        "an HTTP(S) origin without credentials, path, query or fragment",
      );
});

/** Comma-separated entries, each trimmed, empty ones dropped. */
export const list = type("string").pipe((value) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

/**
 * Returns a reader for the environment `schema` describes. It validates the whole environment, the
 * process's own by default, and throws one error that lists every problem, each line naming the
 * variable and the rule but never the value.
 */
export const reader =
  <const schema extends Type<object>>(schema: schema) =>
  (raw: Record<string, string | undefined> = process.env): schema["infer"] => {
    // Leave unset variables out rather than present as undefined.
    const env = schema(
      Object.fromEntries(
        Object.entries(raw).filter(([, value]) => value !== undefined),
      ),
    );
    if (!(env instanceof type.errors)) return env;
    // ArkType's own message ends with the refused value, and no ArkType config hides it from every
    // error, so each line is built from the variable's name and the rule.
    const lines = env.map((error) => {
      const line = `- ${error.propString} must be ${error.expected}`;
      return error.code === "required" ? `${line} (missing)` : line;
    });
    throw new Error(["The environment is not valid:", ...lines].join("\n"));
  };
