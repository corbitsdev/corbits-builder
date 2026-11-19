import { type } from "arktype";
import manifest from "../package.json";

// The handle that a release on DigitalOcean, and what is held there, are recorded under.
export const TARGET = "digitalocean";

// The target's name as the person reads it.
export const PLACE = "DigitalOcean";

// The person's sign-in at DigitalOcean, as the manifest declares it.
export const CREDENTIAL =
  "digitalocean" satisfies keyof typeof manifest.builder.credentials;

// The key to the server, which the hub makes for this plugin's create and remove actions.
export const SERVER_CREDENTIAL =
  "digitalocean-server" satisfies keyof typeof manifest.builder.credentials;

// The project values this plugin adds.
export const CHOICE = "digitalocean.choice";
export const QUOTE = "digitalocean.quote";
export const SERVER = "digitalocean.server";

// The image every server is made with. The SSH release needs Ubuntu 20.04 or later.
export const IMAGE = "ubuntu-24-04-x64";

// The sizes offered, smallest first, each with the monthly price DigitalOcean listed when this was
// written. A live price that differs is recorded as digitalocean.quote and shown instead. The 512
// MB size is left out because it has too little memory and disk to install and build an app.
export const SIZES = [
  { slug: "s-1vcpu-1gb", memory: "1 GB", disk: "25 GB", monthly: 6 },
  { slug: "s-1vcpu-2gb", memory: "2 GB", disk: "50 GB", monthly: 12 },
  { slug: "s-2vcpu-4gb", memory: "4 GB", disk: "80 GB", monthly: 24 },
] as const;

// The regions a server can run in, by DigitalOcean's slug. The first is offered first, and the
// smallest size was seen on offer there.
export const REGIONS = [
  { slug: "sfo3", city: "San Francisco" },
  { slug: "nyc3", city: "New York" },
  { slug: "lon1", city: "London" },
  { slug: "ams3", city: "Amsterdam" },
  { slug: "fra1", city: "Frankfurt" },
  { slug: "sgp1", city: "Singapore" },
  { slug: "blr1", city: "Bangalore" },
] as const;

export const SizeSlug = type.enumerated(...SIZES.map(({ slug }) => slug));
export const RegionSlug = type.enumerated(...REGIONS.map(({ slug }) => slug));

// A price as the person reads it, such as "$6 a month" or "$6.50 a month".
export const monthlyWords = (monthly: number) =>
  `$${Number.isInteger(monthly) ? String(monthly) : monthly.toFixed(2)} a month`;

// The team a sign-in bills, as the provider named it when the person signed in.
export const Team = type({
  "+": "reject",
  id: "string > 0",
  "name?": "string > 0",
});
export type Team = typeof Team.infer;

// What the person agreed to on the account screen: size, region, the monthly price they were shown,
// the team that pays, and when they agreed. The tools count their tries per `at`.
export const Choice = type({
  "+": "reject",
  size: SizeSlug,
  region: RegionSlug,
  monthly: "number > 0",
  team: Team,
  at: "string.date.iso",
});
export type Choice = typeof Choice.infer;

// The live monthly price a tool found for a size when it differed from the one shown.
export const Quote = type({
  "+": "reject",
  size: "string > 0",
  monthly: "number > 0",
});
export type Quote = typeof Quote.infer;

// The tools' note of the server, saved as they go. Stage "creating" marks a create under way, with
// the id DigitalOcean gave the server once it is known. Stage "bound" adds the address once the hub
// has bound Builder's key on it. Both keep the hub's label for the server, so the server can still
// be found after the hub stops giving this plugin that label. Both keep the team it is made under,
// because DigitalOcean reports another team's server as missing. With no stage, nothing is made,
// and the note keeps only how many servers were made for the choice agreed at `for`. Code that
// destroys a server never trusts the note alone: it also checks the team, the server's name and its
// address.
const Bound = type({
  "+": "reject",
  stage: "'bound'",
  id: "string > 0",
  address: "string > 0",
  label: "string > 0",
  team: Team,
});
const Unbound = type({
  "+": "reject",
  "stage?": "'creating'",
  "id?": "string > 0",
  "label?": "string > 0",
  "team?": Team,
  attempts: "number.integer >= 0",
  "for?": "string.date.iso",
});
export const ServerNote = Bound.or(Unbound);
export type ServerNote = typeof ServerNote.infer;
export type BoundNote = typeof Bound.infer;
export type UnboundNote = typeof Unbound.infer;
