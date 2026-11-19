import { type } from "arktype";

// Each piece describes what it expects in words. None puts the refused value in its error, because
// the value can be a secret.

/** A variable that must hold something other than whitespace. */
export const filled = type("string").pipe((value, ctx) =>
  value.trim() === "" ? ctx.error("non-blank") : value,
);

/** Text with surrounding whitespace trimmed; blank text counts as unset. */
export const trimmed = type("string").pipe(
  (value): string | undefined => value.trim() || undefined,
);

/** An on/off switch: "true" or "false", with `fallback` when unset or empty. */
export const flag = (fallback: boolean) =>
  type("string")
    .pipe((value, ctx) => {
      if (value === "") return fallback;
      if (value === "true" || value === "false") return value === "true";
      return ctx.error("true or false");
    })
    .default("");

/** A whole number above zero, as Number reads it. */
export const positiveInteger = type("string").pipe((value, ctx) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : ctx.error("a positive integer");
});

/** A TCP port, 1 to 65535. */
export const port = type("string").pipe((value, ctx) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : ctx.error("an integer between 1 and 65535");
});

/** `value` as a URL, when it parses with one of `protocols` and has no username or password. */
export const parseURL = (value: string, protocols: readonly string[]) => {
  const url = URL.parse(value);
  return url &&
    protocols.includes(url.protocol) &&
    !url.username &&
    !url.password
    ? url
    : undefined;
};

/** An HTTP(S) origin with no credentials, path, query or fragment, read as its origin. */
export const origin = type("string").pipe((value, ctx) => {
  const url = parseURL(value, ["http:", "https:"]);
  return url && url.pathname === "/" && !url.search && !url.hash
    ? url.origin
    : ctx.error(
        "an HTTP(S) origin without credentials, path, query or fragment",
      );
});

/** A 256-bit key as 64 hexadecimal characters. */
export const hexKey = type(/^[a-f\d]{64}$/i).describe(
  "64 hexadecimal characters",
);

/** Comma-separated entries, each trimmed, empty ones dropped. */
export const list = type("string").pipe((value) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
