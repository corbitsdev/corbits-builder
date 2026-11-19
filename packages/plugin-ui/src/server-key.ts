/**
 * Reads the address a person typed for the server they connect. The hub makes and stores its key.
 */
import { SSH_PORT } from "@corbits-builder/plugin/server-address";
import type { ServerAddress } from "@corbits-builder/schemas/settings";

/**
 * The server named by an address a person typed: an IP address or host name, then optionally a
 * colon and a port (an IPv6 address needs brackets to take a port). Undefined when it names none.
 */
export function readServerAddress(typed: string): ServerAddress | undefined {
  const text = typed.trim();
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  const colons = text.split(":").length - 1;
  const [host, port] = bracketed
    ? [bracketed[1], bracketed[2]]
    : // More than one colon is an IPv6 address without a port.
      colons > 1
      ? [text, undefined]
      : text.split(":");
  if (host === undefined || !/^[^\s/@[\]]+$/.test(host)) return undefined;
  if (port === undefined) return { host, port: SSH_PORT };
  const number = Number(port);
  return /^\d{1,5}$/.test(port) && number >= 1 && number <= 65535
    ? { host, port: number }
    : undefined;
}
