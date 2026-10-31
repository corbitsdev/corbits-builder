// Error messages leave out response bodies, which may contain credentials.
const REQUEST_TIMEOUT_MS = 30_000;

export class DockerEngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type DockerRequestOpts = {
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number;
};

export type DockerEngine = {
  /** The daemon address, as `DOCKER_HOST` writes it. */
  readonly host: string;
  request(
    method: string,
    path: string,
    opts?: DockerRequestOpts,
  ): Promise<unknown>;
};

/** Docker's client TLS files, as `DOCKER_CERT_PATH` holds them. */
export type DockerTls = {
  readonly ca: string;
  readonly cert: string;
  readonly key: string;
};

/**
 * Whether a hostname names this machine: `localhost`, 127.0.0.0/8 in any IPv4 spelling, `0.0.0.0`, `::`, `::1` and
 * IPv4-mapped loopback. Any other name, even one that resolves to this machine, counts as another machine.
 */
export function isThisMachine(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  if (name === "localhost") return true;
  let normalized: string;
  try {
    // http parses IPv4 short and hex forms, which other schemes leave as text.
    normalized = new URL(`http://${name}`).hostname;
  } catch {
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized))
    return normalized.startsWith("127.") || normalized === "0.0.0.0";
  return (
    normalized === "[::1]" ||
    normalized === "[::]" ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(normalized)
  );
}

/** Whether the daemon runs on this machine: a unix socket, or a `tcp://` address `isThisMachine` accepts. */
function isLocalDockerHost(host: string): boolean {
  const address = new URL(host);
  return address.protocol === "unix:" || isThisMachine(address.hostname);
}

/**
 * A client for the Docker Engine API at `unix:///path` or `tcp://host:port`, over TLS when `tls` is given. Throws for
 * any other address, and for `tcp://` to another machine without TLS.
 */
export function connectDocker(host: string, tls?: DockerTls): DockerEngine {
  const address = new URL(host);
  if (address.username || address.password)
    throw new Error("Docker host must not contain credentials");
  if (address.protocol !== "unix:" && address.protocol !== "tcp:") {
    throw new Error(`Docker host ${host} must be unix:// or tcp://`);
  }
  if (tls === undefined && !isLocalDockerHost(host)) {
    throw new Error(
      `Docker host ${host} is another machine; supply explicit TLS material to connectDocker`,
    );
  }
  const scheme = tls === undefined ? "http" : "https";
  const base =
    address.protocol === "unix:"
      ? "http://docker"
      : `${scheme}://${address.host}`;
  const transport =
    address.protocol === "unix:"
      ? { unix: address.pathname }
      : { ...(tls !== undefined && { tls }) };

  return {
    host,
    async request(
      method,
      path,
      { body, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {},
    ) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetch(`${base}${path}`, {
        method,
        ...transport,
        signal:
          signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        ...(body !== undefined && {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new DockerEngineError(
          response.status,
          `Docker ${method} ${path.split("?")[0]} failed (${String(response.status)})`,
        );
      }
      return text === "" || text === "OK" ? null : JSON.parse(text);
    },
  };
}
