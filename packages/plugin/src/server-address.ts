// SSH's default port, which a server's address leaves out when the server uses it.
export const SSH_PORT = 22;

/**
 * How a server is named to the person, from the ssh origin it is pinned to: its address, with the
 * port only when it is not SSH's, as they would type it.
 */
export function serverLabel(origin: string): string {
  const url = new URL(origin);
  return url.port === "" || Number(url.port) === SSH_PORT
    ? url.hostname
    : url.host;
}
