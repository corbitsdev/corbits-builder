import { generateServerKey } from "@corbits-builder/plugin/server-key";

/**
 * The host key a new server presents, made in the tool's memory for one call. fingerprint is the
 * public half's, and the hub pins its first sign-in to it. userData gives the provider the key pair
 * and turns password sign-in off. The private half appears only in userData and leaves the call no
 * other way.
 */
export type HostKey = { fingerprint: string; userData: string };

/** The SHA256 fingerprint of an OpenSSH public key line, as `ssh-keygen -l` and the hub write it. */
export async function fingerprintOf(publicKey: string) {
  const blob = Uint8Array.from(
    atob(publicKey.trim().split(/\s+/)[1] ?? ""),
    (char) => char.charCodeAt(0),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", blob));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `SHA256:${btoa(binary).replace(/=+$/, "")}`;
}

// cloud-init writes these host keys in place of the image's and makes no others. It leaves root's
// key sign-in on, because the SSH release signs in as root.
function cloudConfig(pair: { publicKey: string; privateKey: string }) {
  const privateLines = pair.privateKey
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`);
  return [
    "#cloud-config",
    "ssh_pwauth: false",
    "disable_root: false",
    "ssh_deletekeys: true",
    "ssh_genkeytypes: []",
    "ssh_keys:",
    "  ed25519_private: |",
    ...privateLines,
    `  ed25519_public: ${pair.publicKey}`,
    "",
  ].join("\n");
}

export async function makeHostKey(): Promise<HostKey> {
  const pair = await generateServerKey("builder-host");
  return {
    fingerprint: await fingerprintOf(pair.publicKey),
    userData: cloudConfig(pair),
  };
}
