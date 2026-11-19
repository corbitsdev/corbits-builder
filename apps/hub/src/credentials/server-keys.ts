/**
 * Makes and saves server keys, for a plugin's runs and for a person connecting their own server. No
 * other code makes a server key. The asker gets a key, puts its public half on the server, and asks
 * the hub to bind it once the server is up. The hub signs in to the server with the key, and only
 * if that works saves it as the plugin's ssh credential in the project. The private half leaves the
 * hub only as that credential's secret, and no answer, error or log line includes it.
 */
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { provider } from "@intx/db/schema";
import { getLogger } from "@intx/log";
import {
  createSshCredentialProvider,
  isDeniedSshAddress,
  readSshHostKey,
  SshCredentialError,
  sshAddressOf,
  sshOrigin,
} from "@intx/harness";
import { sshCredentialFailure, type CredentialCipher } from "@intx/types";
import { SSH_PORT, serverLabel } from "@corbits-builder/plugin/server-address";
import { generateServerKey } from "@corbits-builder/plugin/server-key";
import type {
  PersonServerKeyRefusalCode,
  PersonServerKeyState,
  ServerAddress,
  ServerKeyBind,
  ServerKeyIssue,
  ServerKeyState,
} from "@corbits-builder/schemas/settings";
import { project, serverKey } from "../db/schema.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  credentialMetadata,
  dropPluginCredential,
  heldPluginCredential,
  holdPluginCredential,
  SSH_PLUGIN,
} from "./plugin-credentials.ts";

const log = getLogger(["corbits-builder", "server-keys"]);

// The user a server key signs in as. The server is rented for this, so all of it is the person's.
const SERVER_USER = "root";

// Proves a key signs in without changing anything on the server.
const PROOF = ["true"];
const PROOF_TIMEOUT_MS = 20_000;

// The server's provider is given the label and may use it as the host name.
const LABEL_PREFIX = "builder-";
const LABEL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LABEL_LENGTH = 12;

// Bytes at or above the largest multiple of the alphabet's size are drawn again, so every character
// is equally likely.
const LABEL_BYTES = 256 - (256 % LABEL_ALPHABET.length);

function mintLabel() {
  let label = LABEL_PREFIX;
  while (label.length < LABEL_PREFIX.length + LABEL_LENGTH) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte! < LABEL_BYTES)
      label += LABEL_ALPHABET[byte! % LABEL_ALPHABET.length];
  }
  return label;
}

/** Domain-separated from `credentialAad`, so a sealed issued key never opens as a credential's secret. */
const sealedKeyAad = (id: string) =>
  JSON.stringify(["sb-server-key-private", id]);

// The issuer of a key a person asked for. A plugin's issuer is its handle with a prefix, so no
// plugin handle can pass as the person and read their key.
const PERSON = "person";
const pluginIssuer = (handle: string) => `plugin:${handle}`;

/** The project a server key is made in, and who asks: the person, or a plugin's run. */
export type ServerKeyOwner = {
  tenantId: string;
  projectId: string;
  issuer: string;
};

/** The owner of the keys a run of the plugin `handle` asks for in its project. */
export const runOwner = (
  tenantId: string,
  projectId: string,
  handle: string,
): ServerKeyOwner => ({ tenantId, projectId, issuer: pluginIssuer(handle) });

const refused = (
  status: 400 | 404 | 409 | 422 | 502,
  code: PersonServerKeyRefusalCode,
) => new ProjectError(status, code);

// What the log says about a key: who asked, in which project, under which name. Never the key, the
// address or anything the server said.
const about = (owner: ServerKeyOwner, name: string) => ({
  projectId: owner.projectId,
  issuer: owner.issuer,
  credential: name,
});

type Row = typeof serverKey.$inferSelect;
type Target = { origin: string; host: string; port: number };

export function createServerKeys(
  db: DB["db"],
  cipher: CredentialCipher,
  ssh: { allowPrivateAddresses: boolean },
  // Removes a revoked credential from the running runs that have it, as Interchange's revoke does.
  pushRevoke: (tenantId: string, credentialId: string) => void,
) {
  const rowOf = async (owner: ServerKeyOwner, name: string) => {
    const [row] = await db
      .select()
      .from(serverKey)
      .where(
        and(eq(serverKey.tenantId, owner.tenantId), eq(serverKey.name, name)),
      );
    return row;
  };

  // A credential with the key's name belongs to this key when its metadata has the public half.
  const isThisKey = (
    held: { metadata: unknown } | undefined,
    row: { publicKey: string },
  ) =>
    held !== undefined &&
    credentialMetadata(held, "publicKey") === row.publicKey;

  // The key's state as a run sees it. An active credential with this name that is not this key was
  // saved by someone else, and the run may not read or change it.
  async function stateOf(row: Row): Promise<ServerKeyState> {
    const held = await heldPluginCredential(db, row.tenantId, row.name);
    const active = held?.status === "active";
    if (active && !isThisKey(held, row)) throw refused(409, "server_key_taken");
    const state = { publicKey: row.publicKey, label: row.label };
    if (row.stage === "issued") return { ...state, state: "issued" };
    return {
      ...state,
      state: active ? "bound" : "lost",
      address: row.boundHost!,
    };
  }

  // The address a bind pins the key to. It must be a public IP literal on SSH's port, unless this
  // hub may reach private addresses, as in development.
  function pinned(server: ServerKeyBind) {
    if (isIP(server.host) === 0) throw refused(400, "invalid_address");
    const port = server.port ?? SSH_PORT;
    if (
      !ssh.allowPrivateAddresses &&
      (port !== SSH_PORT || isDeniedSshAddress(server.host))
    )
      throw refused(422, "address_refused");
    const origin = sshOrigin(server.host, port);
    return { origin, ...sshAddressOf(origin) };
  }

  // Signs in to the server with the key, pinned to its address and host key, and runs a command
  // that changes nothing. While the server is not ready it throws a refusal, and the caller may try
  // again later.
  async function prove(origin: string, secret: string) {
    const handle = createSshCredentialProvider({
      allowPrivateAddresses: ssh.allowPrivateAddresses,
    }).shape({ origin, readCurrentMaterial: () => ({ secret }) });
    if (handle.kind !== "ssh") throw new Error("ssh_provider_not_ssh");
    let code: number | null;
    try {
      ({ code } = await handle.exec(PROOF, { timeoutMs: PROOF_TIMEOUT_MS }));
    } catch (error) {
      const failure = sshCredentialFailure(error);
      if (failure === "host_key_changed")
        throw refused(502, "server_host_key_mismatch");
      if (failure === "auth_failed") throw refused(502, "server_refused_key");
      // A host name a person typed may resolve elsewhere by the time the hub signs in.
      if (failure === "address_refused") throw refused(422, "address_refused");
      if (failure === "unreachable" || failure === "timeout")
        throw refused(502, "server_unreachable");
      throw error;
    } finally {
      await handle.dispose();
    }
    // Signed in, but the account the key opens cannot run a command.
    if (code !== 0) throw refused(502, "server_refused_key");
  }

  // A new key pair for `owner` under `name`, its private half sealed, as a row to insert.
  async function issued(owner: ServerKeyOwner, name: string) {
    const id = crypto.randomUUID();
    const label = mintLabel();
    const made = await generateServerKey(label);
    return {
      id,
      tenantId: owner.tenantId,
      projectId: owner.projectId,
      name,
      issuer: owner.issuer,
      stage: "issued" as const,
      publicKey: made.publicKey,
      sealedPrivateKey: await cipher.encrypt(made.privateKey, sealedKeyAad(id)),
      label,
    };
  }

  // The key's state as a person sees it. If its credential was revoked or replaced since, the key
  // is lost and the next ask makes another.
  async function personState(row: Row): Promise<PersonServerKeyState> {
    if (row.stage === "issued")
      return { publicKey: row.publicKey, state: "issued" };
    const held = await heldPluginCredential(db, row.tenantId, row.name);
    const bound = held?.status === "active" && isThisKey(held, row);
    return {
      publicKey: row.publicKey,
      state: bound ? "bound" : "lost",
      address: serverLabel(sshOrigin(row.boundHost!, row.boundPort!)),
    };
  }

  const sameServer = (row: Row, target: Target, hostKey: string) =>
    row.boundHost === target.host &&
    row.boundPort === target.port &&
    row.hostKey === hostKey;

  // Signs in to `target` with the key `row` issued, pinned to `hostKey`. Only if that works does
  // it save the key as `owner`'s credential under `name` and delete the hub's copy of the private
  // half. `mayReplace` decides whether an existing credential with that name may be replaced.
  async function proveAndSave(
    owner: ServerKeyOwner,
    name: string,
    row: Row,
    target: Target,
    hostKey: string,
    mayReplace: (
      held: Awaited<ReturnType<typeof heldPluginCredential>>,
      current: Row,
    ) => boolean,
  ): Promise<Row> {
    const secret = JSON.stringify({
      host: target.host,
      port: target.port,
      user: SERVER_USER,
      privateKey: await cipher.decrypt(
        row.sealedPrivateKey!,
        sealedKeyAad(row.id),
      ),
      hostKey,
    });
    await prove(target.origin, secret);
    const bound = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(serverKey)
        .where(eq(serverKey.id, row.id))
        .for("update");
      // While the hub signed in, the key was revoked or replaced, or a racing bind bound it.
      if (!current) throw refused(409, "server_key_not_issued");
      if (current.stage === "bound") {
        if (!sameServer(current, target, hostKey))
          throw refused(409, "server_key_bound_elsewhere");
        return current;
      }
      const held = await heldPluginCredential(tx, owner.tenantId, name);
      if (!mayReplace(held, current)) throw refused(409, "server_key_taken");
      await holdPluginCredential(tx, cipher, {
        tenantId: owner.tenantId,
        name,
        shape: { plugin: SSH_PLUGIN, apiBaseUrl: target.origin },
        secret,
        metadata: { publicKey: current.publicKey },
      });
      const [saved] = await tx
        .update(serverKey)
        .set({
          stage: "bound",
          sealedPrivateKey: null,
          boundHost: target.host,
          boundPort: target.port,
          hostKey,
          boundAt: new Date(),
        })
        .where(eq(serverKey.id, row.id))
        .returning();
      return saved!;
    });
    log.info("A server key was bound", about(owner, name));
    return bound;
  }

  // A refused bind goes back to the asker; the log records only its code.
  async function binding<T>(
    owner: ServerKeyOwner,
    name: string,
    bind: () => Promise<T>,
  ) {
    try {
      return await bind();
    } catch (error) {
      if (error instanceof ProjectError)
        log.info("A server key bind was refused: {code}", {
          code: error.code,
          ...about(owner, name),
        });
      throw error;
    }
  }

  return {
    /**
     * The owner of the keys a person connects their own servers with, in the project of `tenantId`.
     * Only a project can have a server key: in a workspace, every project's runs would have root on
     * the server.
     */
    async personOwner(tenantId: string): Promise<ServerKeyOwner> {
      const [found] = await db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.tenantId, tenantId));
      if (!found) throw refused(409, "server_key_project_only");
      return { tenantId, projectId: found.id, issuer: PERSON };
    },

    /** The key `owner` has under `name`, made now if the project has none with that name. */
    async key(owner: ServerKeyOwner, name: string): Promise<ServerKeyState> {
      let row = await rowOf(owner, name);
      if (!row) {
        const held = await heldPluginCredential(db, owner.tenantId, name);
        if (held?.status === "active") throw refused(409, "server_key_taken");
        // A racing second ask finds the row the first one made and keeps that key.
        const [made] = await db
          .insert(serverKey)
          .values(await issued(owner, name))
          .onConflictDoNothing()
          .returning({ id: serverKey.id });
        if (made) log.info("A server key was issued", about(owner, name));
        row = (await rowOf(owner, name))!;
      }
      if (row.issuer !== owner.issuer) throw refused(409, "server_key_taken");
      return stateOf(row);
    },

    /** Like `key`, but never makes a key. */
    async state(owner: ServerKeyOwner, name: string): Promise<ServerKeyState> {
      const row = await rowOf(owner, name);
      if (!row) throw refused(404, "server_key_not_issued");
      if (row.issuer !== owner.issuer) throw refused(409, "server_key_taken");
      return stateOf(row);
    },

    /**
     * The server a person's project is connected to under `name`, or the key they were given to
     * connect one. It never makes a key. Asking for a key for another server replaces the bound row
     * with an issued one, but the connected server stays the project's credential. So that server
     * is read from the credential: its pinned address and the public half in its metadata.
     */
    async personHeld(
      owner: ServerKeyOwner,
      name: string,
    ): Promise<PersonServerKeyState> {
      const row = await rowOf(owner, name);
      if (row?.stage === "bound") return personState(row);
      // Until a key for a different server is connected, the connected server stays.
      const held = await heldPluginCredential(db, owner.tenantId, name);
      const publicKey = held && credentialMetadata(held, "publicKey");
      if (held?.status === "active" && publicKey !== undefined) {
        const [server] = await db
          .select({ origin: provider.apiBaseUrl })
          .from(provider)
          .where(
            and(
              eq(provider.id, held.providerId),
              eq(provider.plugin, SSH_PLUGIN),
            ),
          );
        if (server?.origin)
          return {
            publicKey,
            state: "bound",
            address: serverLabel(server.origin),
          };
      }
      if (!row) throw refused(404, "server_key_not_issued");
      return personState(row);
    },

    /** Proves the issued key on `server`, then saves it as the plugin's ssh credential there. */
    async bind(
      owner: ServerKeyOwner,
      name: string,
      server: ServerKeyBind,
    ): Promise<ServerKeyState> {
      return binding(owner, name, async () => {
        const row = await rowOf(owner, name);
        if (!row) throw refused(409, "server_key_not_issued");
        if (row.issuer !== owner.issuer) throw refused(409, "server_key_taken");
        const target = pinned(server);
        if (row.stage === "bound") {
          if (!sameServer(row, target, server.hostKey))
            throw refused(409, "server_key_bound_elsewhere");
          return stateOf(row);
        }
        // Refuses a taken name before the hub dials anything.
        await stateOf(row);
        const bound = await proveAndSave(
          owner,
          name,
          row,
          target,
          server.hostKey,
          // A run never replaces a credential it did not make.
          (held, current) =>
            !(held?.status === "active") || isThisKey(held, current),
        );
        return stateOf(bound);
      });
    },

    /**
     * The key a person connects their own server with under `name`. A key they have not connected
     * yet is given again unless they ask for a new one. Once it is connected, the next ask makes a
     * key for another server.
     */
    async issue(
      owner: ServerKeyOwner,
      name: string,
      ask: ServerKeyIssue,
    ): Promise<PersonServerKeyState> {
      const row = await rowOf(owner, name);
      if (row?.stage === "issued" && !ask.fresh) return personState(row);
      const next = await issued(owner, name);
      const [made] = await db.transaction(async (tx) => {
        if (row) await tx.delete(serverKey).where(eq(serverKey.id, row.id));
        return tx
          .insert(serverKey)
          .values(next)
          .onConflictDoNothing()
          .returning();
      });
      if (made) log.info("A server key was issued", about(owner, name));
      // An ask racing this one made the key first.
      const current = made ?? (await rowOf(owner, name));
      if (!current) throw refused(409, "server_key_not_issued");
      return personState(current);
    },

    /**
     * Reads the host key of the server at the address the person typed, proves their issued key
     * signs in to it, and only then saves the key, replacing any key the project had under `name`.
     * So the server at that address reads as connected only once the key has signed in to it.
     */
    async connect(
      owner: ServerKeyOwner,
      name: string,
      server: ServerAddress,
    ): Promise<PersonServerKeyState> {
      return binding(owner, name, async () => {
        const row = await rowOf(owner, name);
        if (row?.stage !== "issued")
          throw refused(409, "server_key_not_issued");
        let target: Target;
        let hostKey: string;
        try {
          const origin = sshOrigin(server.host, server.port);
          target = { origin, ...sshAddressOf(origin) };
          // A person typed the address, so the key the server presents now is the one trusted.
          hostKey = await readSshHostKey(target.host, target.port, ssh);
        } catch (error) {
          if (!(error instanceof SshCredentialError)) throw error;
          if (error.failure === "invalid_origin")
            throw refused(400, "invalid_address");
          if (error.failure === "address_refused")
            throw refused(422, "address_refused");
          throw refused(502, "server_unreachable");
        }
        return personState(
          await proveAndSave(owner, name, row, target, hostKey, () => true),
        );
      });
    },

    /**
     * Deletes the key `owner` made under `name` and revokes the credential it became. A key with
     * that name that someone else made or connected is left alone.
     */
    async revoke(owner: ServerKeyOwner, name: string) {
      const row = await rowOf(owner, name);
      if (!row || row.issuer !== owner.issuer) return { revoked: false };
      const outcome = await db.transaction(async (tx) => {
        const [current] = await tx
          .delete(serverKey)
          .where(eq(serverKey.id, row.id))
          .returning();
        // Revoked by a call that raced this one.
        if (!current) return { revoked: false };
        const held = await heldPluginCredential(tx, owner.tenantId, name);
        if (!held || !isThisKey(held, current)) return { revoked: true };
        await dropPluginCredential(tx, owner.tenantId, held.id);
        return { revoked: true, credentialId: held.id };
      });
      if (outcome.credentialId !== undefined)
        pushRevoke(owner.tenantId, outcome.credentialId);
      if (outcome.revoked)
        log.info("A server key was revoked", {
          ...about(owner, name),
          credentialRevoked: outcome.credentialId !== undefined,
        });
      return { revoked: outcome.revoked };
    },
  };
}

export type ServerKeys = ReturnType<typeof createServerKeys>;
