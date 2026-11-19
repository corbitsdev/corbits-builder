import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { buildCredentialDelivery } from "@intx/db";
import { createSshCredentialProvider } from "@intx/harness";
import { hexDecode, type CredentialBinding } from "@intx/types";

/**
 * What one command on a server answers through the ssh handle a run binding `binding` is given, as
 * Interchange delivers the credential the project's tenant holds to a run and its harness shapes it.
 * `credentialKey` is the hub's CREDENTIAL_ENCRYPTION_KEY.
 */
export async function runOnServer(
  db: Parameters<typeof buildCredentialDelivery>[0]["db"],
  credentialKey: string,
  tenantId: string,
  binding: CredentialBinding,
) {
  const delivered = await buildCredentialDelivery({
    db,
    tenantId,
    bindings: [binding],
    creatorPrincipalId: null,
    invokerPrincipalId: null,
    credentialCipher: createEnvKeyCredentialCipher(hexDecode(credentialKey)),
  });
  if (!delivered.ok) throw new Error(delivered.reason.message);
  const [material] = delivered.delivery?.materials ?? [];
  if (!material) throw new Error("nothing delivered");
  const handle = createSshCredentialProvider({
    allowPrivateAddresses: true,
  }).shape({
    origin: material.origin,
    readCurrentMaterial: () => ({ secret: material.secret }),
  });
  if (handle.kind !== "ssh") throw new Error("not an ssh handle");
  return handle.exec(["uptime"], { timeoutMs: 10_000 });
}
