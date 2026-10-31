import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { derivePublicKeyBytes, generateKeyPair } from "@intx/crypto";
import { hexDecode, hexEncode } from "@intx/types";

export async function loadHubSigningKey(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "hub-signing-key");
  const generated = await generateKeyPair();
  try {
    await writeFile(file, hexEncode(generated.privateKey), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const info = await lstat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error("Hub signing key must be a private regular file (0600)");
  }
  const encoded = (await readFile(file, "utf8")).trim();
  if (!/^[a-f\d]{64}$/i.test(encoded))
    throw new Error("Invalid stored hub signing key");
  const privateKey = hexDecode(encoded);
  return { privateKey, publicKey: await derivePublicKeyBytes(privateKey) };
}
