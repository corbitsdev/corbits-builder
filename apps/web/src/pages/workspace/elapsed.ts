import { useEffect, useState } from "react";

export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * Milliseconds since `since`, ticking every second. `since` is a recorded
 * timestamp — the outgoing mail's, not an inferred run start — so the count
 * is the same after a reload as it was before it.
 */
export function useElapsedMs(since?: string | null): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const parsed = since ? Date.parse(since) : Number.NaN;
    const started = Number.isNaN(parsed) ? Date.now() : parsed;
    const tick = () => setMs(Math.max(0, Date.now() - started));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [since]);
  return ms;
}
