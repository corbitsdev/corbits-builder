import { type, type Type } from "arktype";
import {
  CredentialRefused,
  WorkflowHttpError,
  workflowHttpJson,
  type HttpMethod,
} from "@corbits-builder/plugin/http-json";
import { IMAGE } from "./target.ts";
import {
  ProviderRefused,
  ProviderUnavailable,
  SignedOut,
  type Server,
  type Vendor,
} from "./vendor.ts";

/** The run's access to the person's DigitalOcean sign-in, and how its calls wait and stop. */
export type Client = {
  capabilities: Parameters<typeof workflowHttpJson>[0]["capabilities"];
  // The credential's handle. It adds the person's token to calls to https://api.digitalocean.com.
  handle: string;
  signal: AbortSignal;
  // How the waits after a refused sign-in sleep. Tests pass their own.
  sleep: (ms: number) => Promise<void>;
};

const CALL_TIMEOUT_MS = 30_000;
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
// DigitalOcean lists at most this many of anything on one page.
const PER_PAGE = 200;
// The most pages read of one list, so an answer that always says there is more cannot stall the
// call.
const MAX_PAGES = 50;

/**
 * Turns a failed call into the error the provisioning sequence handles. A sign-in DigitalOcean kept
 * refusing after the waits a renewed one gets is SignedOut. No answer, a server error, a 429, a
 * redirect or an answer that is not JSON is ProviderUnavailable. Any other refusal is
 * ProviderRefused, with DigitalOcean's message.
 */
export function vendorError(error: unknown): unknown {
  if (error instanceof CredentialRefused) return new SignedOut();
  if (error instanceof WorkflowHttpError) {
    const { status } = error;
    if (status === undefined || status < 400 || status >= 500 || status === 429)
      return new ProviderUnavailable({ cause: error });
    return new ProviderRefused(status, error.words);
  }
  // An answer that is not JSON, or not UTF-8.
  if (error instanceof SyntaxError || error instanceof TypeError)
    return new ProviderUnavailable({ cause: error });
  return error;
}

// One call through the shared client. The client retries only after a refused sign-in, so a create
// that timed out or failed on DigitalOcean's side is never sent twice.
async function call<T>(
  client: Client,
  method: HttpMethod,
  path: string,
  shape: Type<T>,
  body?: object,
): Promise<T> {
  let answer: unknown;
  try {
    answer = await workflowHttpJson({
      capabilities: client.capabilities,
      handle: client.handle,
      path,
      method,
      ...(body === undefined ? {} : { body }),
      signedIn: { sleep: client.sleep },
      timeoutMs: CALL_TIMEOUT_MS,
      maxResponseBytes: MAX_ANSWER_BYTES,
      signal: client.signal,
    });
  } catch (error) {
    if (client.signal.aborted) throw error;
    throw vendorError(error);
  }
  const checked = shape(answer);
  if (checked instanceof type.errors) throw new ProviderUnavailable();
  return checked as T;
}

const Account = type({
  account: {
    status: "string",
    "status_message?": "string | null",
    "droplet_limit?": "number",
    "email_verified?": "boolean",
    "team?": type({ uuid: "string > 0", "name?": "string", "+": "ignore" }).or(
      "null",
    ),
    "+": "ignore",
  },
  "+": "ignore",
});

const Sizes = type({
  sizes: type({
    slug: "string",
    price_monthly: "number",
    regions: "string[]",
    available: "boolean",
    "+": "ignore",
  }).array(),
  "+": "ignore",
});

const Droplet = type({
  id: "number | string",
  name: "string",
  status: "string",
  "networks?": {
    "v4?": type({
      ip_address: "string",
      type: "string",
      "+": "ignore",
    }).array(),
    "+": "ignore",
  },
  "+": "ignore",
});
type Droplet = typeof Droplet.infer;

const OneDroplet = type({ droplet: Droplet, "+": "ignore" });
const Droplets = type({ droplets: Droplet.array(), "+": "ignore" });

const Key = type({
  id: "number | string",
  name: "string",
  public_key: "string",
  "+": "ignore",
});
const OneKey = type({ ssh_key: Key, "+": "ignore" });
const Keys = type({
  ssh_keys: Key.array(),
  "links?": type({
    "pages?": type({ "next?": "string", "+": "ignore" }),
    "+": "ignore",
  }).or("null"),
  "+": "ignore",
});

const Nothing = type("unknown");

const STATES: Readonly<Record<string, Server["state"]>> = {
  new: "starting",
  active: "running",
};

function serverOf(droplet: Droplet): Server {
  const address = droplet.networks?.v4?.find(
    (network) => network.type === "public",
  )?.ip_address;
  return {
    id: String(droplet.id),
    name: droplet.name,
    state: STATES[droplet.status] ?? "off",
    ...(address === undefined ? {} : { address }),
  };
}

// The type and key of an OpenSSH public key line, without the comment, because DigitalOcean may
// keep or drop it.
const keyOf = (line: string) => line.trim().split(/\s+/).slice(0, 2).join(" ");

const segment = (value: string) => encodeURIComponent(value);

async function accountKeys(client: Client) {
  const all: (typeof Key.infer)[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { ssh_keys, links } = await call(
      client,
      "GET",
      `/v2/account/keys?page=${page}&per_page=${PER_PAGE}`,
      Keys,
    );
    all.push(...ssh_keys);
    if (ssh_keys.length === 0 || links?.pages?.next === undefined) break;
  }
  return all;
}

// DigitalOcean refuses a second copy of a key it already has (422), so a key an earlier run added
// is reused.
async function loginKeyId(client: Client, label: string, publicKey: string) {
  try {
    const { ssh_key } = await call(client, "POST", "/v2/account/keys", OneKey, {
      name: label,
      public_key: publicKey,
    });
    return String(ssh_key.id);
  } catch (error) {
    if (!(error instanceof ProviderRefused) || error.status !== 422)
      throw error;
  }
  const held = (await accountKeys(client)).find(
    (key) => keyOf(key.public_key) === keyOf(publicKey),
  );
  if (held === undefined) throw new ProviderRefused(422);
  return String(held.id);
}

/** DigitalOcean's API, called with the person's sign-in, as the provisioning sequence's Vendor. */
export function digitalOcean(client: Client): Vendor {
  return {
    account: async () => {
      const { account } = await call(client, "GET", "/v2/account", Account);
      const team =
        account.team === undefined || account.team === null
          ? undefined
          : {
              id: account.team.uuid,
              ...(account.team.name ? { name: account.team.name } : {}),
            };
      const blocked =
        account.status === "locked" ||
        account.droplet_limit === 0 ||
        account.email_verified === false;
      const message = account.status_message;
      return {
        ...(blocked ? { cannotCreate: message ? { message } : {} } : {}),
        ...(team === undefined ? {} : { team }),
      };
    },
    price: async (size, region) => {
      const { sizes } = await call(
        client,
        "GET",
        `/v2/sizes?per_page=${PER_PAGE}`,
        Sizes,
      );
      const found = sizes.find((each) => each.slug === size);
      if (!found?.available || !found.regions.includes(region))
        return undefined;
      return found.price_monthly;
    },
    find: async (label) => {
      const { droplets } = await call(
        client,
        "GET",
        `/v2/droplets?name=${segment(label)}&per_page=${PER_PAGE}`,
        Droplets,
      );
      return droplets.filter((droplet) => droplet.name === label).map(serverOf);
    },
    server: async (id) => {
      try {
        const { droplet } = await call(
          client,
          "GET",
          `/v2/droplets/${segment(id)}`,
          OneDroplet,
        );
        return serverOf(droplet);
      } catch (error) {
        if (error instanceof ProviderRefused && error.status === 404)
          return undefined;
        throw error;
      }
    },
    create: async ({ label, size, region, loginKey, userData }) => {
      const key = await loginKeyId(client, label, loginKey);
      const { droplet } = await call(
        client,
        "POST",
        "/v2/droplets",
        OneDroplet,
        {
          name: label,
          region,
          size,
          image: IMAGE,
          ssh_keys: [Number(key)],
          user_data: userData,
          monitoring: false,
          backups: false,
          ipv6: false,
        },
      );
      return serverOf(droplet);
    },
    destroy: async (id) => {
      try {
        await call(client, "DELETE", `/v2/droplets/${segment(id)}`, Nothing);
      } catch (error) {
        if (!(error instanceof ProviderRefused) || error.status !== 404)
          throw error;
      }
    },
    settle: async (label) => {
      const keys = await accountKeys(client);
      for (const key of keys.filter((each) => each.name === label))
        try {
          await call(
            client,
            "DELETE",
            `/v2/account/keys/${segment(String(key.id))}`,
            Nothing,
          );
        } catch (error) {
          if (!(error instanceof ProviderRefused) || error.status !== 404)
            throw error;
        }
    },
  };
}
