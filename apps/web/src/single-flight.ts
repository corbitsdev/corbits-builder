/**
 * A poll that fires on a timer must never stack: a read still outstanding
 * is reused by the next tick, so a hung endpoint costs one connection, not
 * one per tick until the browser's per-origin limit stalls every request.
 */
/** Wraps an async function so concurrent calls share the one in-flight promise. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const call = run().finally(() => {
      pending = null;
    });
    pending = call;
    return call;
  };
}
