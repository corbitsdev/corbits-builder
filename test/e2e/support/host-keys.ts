import { utils } from "ssh2";

/**
 * An ed25519 pair for a test server's host key. ssh2 now and then writes one whose public part is a
 * byte short, which it then refuses to parse, so this makes another until both halves read back.
 */
export function hostKeyPair() {
  for (;;) {
    const keys = utils.generateKeyPairSync("ed25519");
    if (
      !(utils.parseKey(keys.public) instanceof Error) &&
      !(utils.parseKey(keys.private) instanceof Error)
    )
      return keys;
  }
}
