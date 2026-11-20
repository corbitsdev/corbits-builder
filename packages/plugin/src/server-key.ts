/**
 * The key pair a server is reached with: the public half for the server's authorized keys, and the
 * private half that Interchange keeps as an ssh credential with the server's address and is never
 * shown. It uses only WebCrypto, so it runs wherever the hub or a plugin's tool does.
 */

const KEY_TYPE = "ssh-ed25519";
const encoder = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

// An SSH string: its length, then its bytes.
const field = (bytes: Uint8Array | string): Uint8Array => {
  const body = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  return concat([uint32(body.length), body]);
};

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type ServerKey = {
  /** One line for a server's authorized keys, as hosting providers ask for it. */
  publicKey: string;
  /** The private key in OpenSSH's format, which is what an SSH client reads. */
  privateKey: string;
  /** The public half's SHA256 fingerprint, as `ssh-keygen -l` writes it and a client pins it. */
  fingerprint: string;
};

/** A new Ed25519 key pair, named by `comment` wherever the public half is listed. */
export async function generateServerKey(comment: string): Promise<ServerKey> {
  // Ed25519 always makes a pair, but Bun's types, which the hub type-checks this with, lack the
  // DOM overload that says so.
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  // PKCS#8 for Ed25519 ends with the 32-byte seed.
  const seed = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ).slice(-32);

  const publicBlob = concat([field(KEY_TYPE), field(publicBytes)]);
  // The format repeats a random number so a reader can tell a wrong passphrase from a right one.
  // This key has no passphrase, but the format still requires the check.
  const check = crypto.getRandomValues(new Uint8Array(4));
  const unpadded = concat([
    check,
    check,
    field(KEY_TYPE),
    field(publicBytes),
    field(concat([seed, publicBytes])),
    field(comment),
  ]);
  const padding = new Uint8Array((8 - (unpadded.length % 8)) % 8).map(
    (_, index) => index + 1,
  );
  const file = concat([
    encoder.encode("openssh-key-v1\0"),
    field("none"),
    field("none"),
    field(""),
    uint32(1),
    field(publicBlob),
    field(concat([unpadded, padding])),
  ]);
  const lines = base64(file).match(/.{1,70}/g) ?? [];
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(publicBlob)),
  );
  return {
    publicKey: `${KEY_TYPE} ${base64(publicBlob)} ${comment}`,
    privateKey: [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      ...lines,
      "-----END OPENSSH PRIVATE KEY-----",
      "",
    ].join("\n"),
    fingerprint: `SHA256:${base64(digest).replace(/=+$/, "")}`,
  };
}
