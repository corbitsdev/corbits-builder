/**
 * What the provisioning sequence needs from DigitalOcean. DigitalOcean's API client implements it,
 * and the sequence's tests drive it through that client against a fake API.
 */

/** The account the sign-in reaches: whether it can create a server now, and the team that pays. */
export type Account = {
  // Set when it cannot, with DigitalOcean's reason when it gave one.
  cannotCreate?: { message?: string };
  team?: { id: string; name?: string };
};

/** A server as the provider lists it. */
export type Server = {
  id: string;
  name: string;
  state: "starting" | "running" | "off";
  // The public IPv4 address, once it has one.
  address?: string;
};

/** What a new server is made with. loginKey is the key Builder signs in with; userData sets the
 * host key and turns password sign-in off. */
export type Spec = {
  label: string;
  size: string;
  region: string;
  loginKey: string;
  userData: string;
};

export type Vendor = {
  account(): Promise<Account>;
  // The monthly price of a size in a region, or undefined when it is not on offer there now.
  price(size: string, region: string): Promise<number | undefined>;
  // The servers named exactly label. A listing may lag a create or a destroy by up to a minute.
  find(label: string): Promise<Server[]>;
  // The server with this id, or undefined once DigitalOcean no longer knows it. That is the only
  // proof a server is gone.
  server(id: string): Promise<Server | undefined>;
  // A refusal throws ProviderRefused. After any other failure the server may still have been made.
  create(spec: Spec): Promise<Server>;
  // A server that is already gone is not a failure.
  destroy(id: string): Promise<void>;
  // Removes what create left at DigitalOcean for label, other than the server, once it is unused.
  settle(label: string): Promise<void>;
};

/** DigitalOcean answered with a refusal: its status, and its message when it gave one. */
export class ProviderRefused extends Error {
  constructor(
    readonly status: number,
    readonly words?: string,
  ) {
    super("provider_refused");
    this.name = "ProviderRefused";
  }
}

/** DigitalOcean could not be reached, failed, or answered in a shape this code does not know. A
 * create that failed this way may still have made the server. */
export class ProviderUnavailable extends Error {
  constructor(options?: ErrorOptions) {
    super("provider_unavailable", options);
    this.name = "ProviderUnavailable";
  }
}

/** DigitalOcean kept refusing the sign-in after the waits a renewed sign-in gets. */
export class SignedOut extends Error {
  constructor() {
    super("signed_out");
    this.name = "SignedOut";
  }
}
