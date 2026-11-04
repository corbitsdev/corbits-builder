/**
 * JSON this interface did not write: hub content, mail, stream frames and
 * browser storage. Text that is not JSON, or JSON of the wrong shape, reads as
 * null so the caller shows its own unreadable state.
 */
import { type, type Type } from "arktype";

export function readJson<S extends Type>(
  text: string,
  schema: S,
): S["infer"] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    return null;
  }
  const read = schema(parsed);
  return read instanceof type.errors ? null : read;
}
