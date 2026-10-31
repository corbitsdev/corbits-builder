/**
 * Where the hub is: same-origin through the dev proxy. The dev server
 * (and the eventual hub-served build) forwards `/api` to the hub origin, so
 * from the page every hub call — product API and better-auth alike — is
 * same-origin: no CORS, and the session cookie rides the page's own jar.
 * The Vite config's `UI_HUB_ORIGIN` picks the hub the proxy forwards to.
 */
export function hubOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Same-origin through the proxy; cookies ride the page's own jar. */
export function hubCredentials(): RequestCredentials {
  return "include";
}

/** `withCredentials` for `EventSource`, which has no `RequestCredentials` union. */
export function hubEventSourceCredentials(): boolean {
  return false;
}
