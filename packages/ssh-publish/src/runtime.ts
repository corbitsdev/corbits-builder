import { createHash } from "node:crypto";
import { unzip } from "@corbits/zip";

// The Bun runtime a prepared server runs the app with. It is the repository's Bun version, and each
// build's SHA-256 is the one Bun's release page publishes. x64 uses the baseline build because many
// rented servers have processors without AVX2.
export const BUN = {
  version: "1.4.4",
  builds: {
    x86_64: {
      asset: "bun-linux-x64-baseline",
      sha256:
        "e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76",
    },
    aarch64: {
      asset: "bun-linux-aarch64",
      sha256:
        "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e",
    },
  },
} as const;
export type Arch = keyof typeof BUN.builds;
export const isArch = (arch: string): arch is Arch =>
  Object.hasOwn(BUN.builds, arch);

const bunDownload = (asset: string) =>
  `https://github.com/oven-sh/bun/releases/download/bun-v${BUN.version}/${asset}.zip`;

export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * The Bun binary for the server's processor, from Bun's release. Returns undefined when the
 * download fails or its SHA-256 is not the one the release published.
 */
export async function bunBinary(
  download: (url: string) => Promise<Uint8Array>,
  arch: Arch,
) {
  const { asset, sha256: published } = BUN.builds[arch];
  let zip: Uint8Array;
  try {
    zip = await download(bunDownload(asset));
  } catch {
    // Unreachable or refused makes no difference to the person: the runtime could not be fetched.
    return undefined;
  }
  if (sha256(zip) !== published) return undefined;
  const binary = (await unzip(new Uint8Array(zip))).find(
    ({ path }) => path === `${asset}/bun`,
  );
  return binary?.data;
}
