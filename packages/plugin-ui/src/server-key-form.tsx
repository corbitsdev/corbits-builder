/**
 * A form that connects a person's own server to a project. The hub makes the server's key and keeps
 * the private key. The form shows the public key for the person to put on their server, takes the
 * server's address, and asks the hub to connect. The hub proves the key signs in to that server
 * before saving it, so "connected" is true when shown. No private key reaches the browser.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Input, Textarea } from "@corbits/react-ui";
import type { SshCredentialDeclaration } from "@corbits-builder/plugin";
import {
  PersonServerKeyState,
  type ServerAddress,
  type ServerKeyIssue,
} from "@corbits-builder/schemas/settings";
import { json, send, refusal } from "./credentials.ts";
import { readServerAddress } from "./server-key.ts";
import styles from "./server-key-form.module.css";

export type ServerKeyFormProps = {
  /** The credential's name as its plugin declares it. */
  name: string;
  declaration: SshCredentialDeclaration;
  /** A server key belongs to the project only. Saved in the workspace, it would give every
   * project's runs root on the server. */
  tenants: { project: string };
  onSaved: () => void;
};

const text = {
  publicKey: "The key to give your hosting provider",
  publicKeyHint:
    "Paste this key where your hosting provider asks for an SSH key when you rent the server.",
  keyKept: "This key stays the same if you leave and come back.",
  making: "Making a key…",
  reading: "Reading your saved server…",
  keyFailed: "A key could not be made. Try again in a moment.",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Not copied. Select the key and copy it yourself.",
  savedServer: "Connected server",
  onServer:
    "Your server needs this key. If your hosting provider didn't add it, rebuild the server with it from their control panel.",
  useSaved: "Use this server",
  another: "Connect a different server",
  newKey: "Make a new key",
  address: "Server address",
  addressHint:
    "Its IP address or host name, as your hosting provider shows it.",
  save: "Connect",
  saving: "Connecting…",
  readFailed: "Your saved server could not be read. Try again in a moment.",
  refused: (code: string): string => {
    switch (code) {
      case "invalid_address":
        return "That is not a server address. Use its IP address or host name.";
      case "address_refused":
        return "That address is on a private network. Use the server's public address.";
      case "server_unreachable":
        return "The server didn't answer. Check the address, and that the server is running.";
      case "server_refused_key":
        return "The server didn't accept the key yet. Add it at your hosting provider, then try again.";
      case "server_host_key_mismatch":
        return "The server changed while it was being connected. Try again in a moment.";
      case "server_key_not_issued":
        return "This key was replaced. Make a new key, add it at your hosting provider, then try again.";
      default:
        return "Not connected. Try again in a moment.";
    }
  },
};

const COPIED_MS = 2_000;

const keyPath = (project: string, name: string, step: "key" | "bind") =>
  `${encodeURIComponent(project)}/server-keys/${encodeURIComponent(name)}/${step}`;

/** The public key the hub issues for the person to connect a server with under `name` in
 * `project`. */
export async function issueServerKey(
  project: string,
  name: string,
  ask: ServerKeyIssue = {},
): Promise<PersonServerKeyState> {
  return PersonServerKeyState.assert(
    await json(keyPath(project, name, "key"), "POST", ask),
  );
}

/** The server `project` is connected to under `name`, or the key the person was given to connect
 * one. Undefined when there is neither. Reading does not make a key. */
export async function heldServerKey(
  project: string,
  name: string,
): Promise<PersonServerKeyState | undefined> {
  const response = await send(keyPath(project, name, "key"), "GET", undefined);
  if (response.status === 404) {
    const refused = await refusal(response);
    if (refused.message === "server_key_not_issued") return undefined;
    throw refused;
  }
  if (!response.ok) throw await refusal(response);
  return PersonServerKeyState.assert(await response.json());
}

/** Has the hub prove the issued key on the server at `server` and save it for the project. */
export async function connectServerKey(
  project: string,
  name: string,
  server: ServerAddress,
): Promise<PersonServerKeyState> {
  return PersonServerKeyState.assert(
    await json(keyPath(project, name, "bind"), "POST", server),
  );
}

/** A server the project is connected to: its address as the person sees it, and the public key. */
export type ConnectedServer = { address: string; publicKey: string };

/** The public key, with a way to copy it. */
function PublicKey({
  id,
  value,
  hint,
  onFault,
}: {
  id: string;
  value: string | undefined;
  hint: string;
  onFault: (fault: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (value === undefined) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (cause) {
      if (!(cause instanceof DOMException)) throw cause;
      onFault(text.copyFailed);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <>
      <label htmlFor={`${id}-public`} className={styles.label}>
        {text.publicKey}
      </label>
      <p id={`${id}-public-hint`} className={styles.hint}>
        {hint}
      </p>
      <div className={styles.publicKey}>
        <Textarea
          id={`${id}-public`}
          readOnly
          rows={3}
          spellCheck={false}
          aria-describedby={`${id}-public-hint`}
          value={value ?? text.making}
          onFocus={(event) => event.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          disabled={value === undefined}
          onClick={() => void copy()}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? text.copied : text.copy}
        </Button>
      </div>
    </>
  );
}

/** What the form shows: reading the saved server, the server the project has a key for, or the key
 * and the address of a server to connect. */
export type ServerKeyStage =
  | { step: "reading" }
  | {
      step: "saved";
      saved: ConnectedServer;
      onUse: () => void;
      onAnother: () => void;
    }
  | {
      step: "new";
      /** Undefined while the hub makes the key. */
      publicKey: string | undefined;
      address: string;
      onAddress: (address: string) => void;
      onConnect: () => void;
      onNewKey: () => void;
      saving: boolean;
    };

export type ServerKeyFormViewProps = {
  /** What the key is for, as its plugin declares it: the form's name. */
  about: string;
  stage: ServerKeyStage;
  fault: string | undefined;
  onFault: (fault: string) => void;
};

/** How the form looks in each stage, drawn from its props alone. */
export function ServerKeyFormView({
  about,
  stage,
  fault,
  onFault,
}: ServerKeyFormViewProps) {
  const id = useId();
  const faultLine =
    fault === undefined ? null : (
      <p className={styles.fault} role="alert">
        {fault}
      </p>
    );
  if (stage.step === "reading")
    return (
      <div className={styles.form} data-slot="server-key-form">
        <p className={styles.hint} role="status">
          {text.reading}
        </p>
        {faultLine}
      </div>
    );
  if (stage.step === "saved")
    return (
      <section
        className={styles.form}
        data-slot="server-key-form"
        aria-label={about}
      >
        <div className={styles.fields}>
          <p className={styles.label}>{text.savedServer}</p>
          <p className={styles.server}>{stage.saved.address}</p>
          <PublicKey
            id={id}
            value={stage.saved.publicKey}
            hint={text.onServer}
            onFault={onFault}
          />
        </div>
        {faultLine}
        <div className={styles.actions}>
          <Button type="button" onClick={stage.onUse}>
            {text.useSaved}
          </Button>
          <Button type="button" variant="outline" onClick={stage.onAnother}>
            {text.another}
          </Button>
        </div>
      </section>
    );
  return (
    <form
      className={styles.form}
      data-slot="server-key-form"
      aria-busy={stage.saving}
      aria-label={about}
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        stage.onConnect();
      }}
    >
      <fieldset className={styles.fields} disabled={stage.saving}>
        <PublicKey
          id={id}
          value={stage.publicKey}
          hint={text.publicKeyHint}
          onFault={onFault}
        />
        <p className={styles.hint}>{text.keyKept}</p>
        <label htmlFor={`${id}-address`} className={styles.label}>
          {text.address}
        </label>
        <p id={`${id}-address-hint`} className={styles.hint}>
          {text.addressHint}
        </p>
        <Input
          id={`${id}-address`}
          value={stage.address}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-address-hint`}
          onChange={(event) => stage.onAddress(event.target.value)}
        />
      </fieldset>
      {faultLine}
      <div className={styles.actions}>
        {/* The button stays enabled while saving, to keep its colour; the fieldset stops input. */}
        <Button
          type="submit"
          disabled={
            stage.publicKey === undefined || stage.address.trim() === ""
          }
        >
          {stage.saving ? text.saving : text.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={stage.saving}
          onClick={stage.onNewKey}
        >
          {text.newKey}
        </Button>
      </div>
    </form>
  );
}

export function ServerKeyForm({
  name,
  declaration,
  tenants,
  onSaved,
}: ServerKeyFormProps) {
  const { project } = tenants;
  const [saved, setSaved] = useState<ConnectedServer | null>();
  const [publicKey, setPublicKey] = useState<string>();
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState<string>();
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);

  const issue = (ask: ServerKeyIssue) => {
    setPublicKey(undefined);
    setFault(undefined);
    issueServerKey(project, name, ask).then(
      (issued) => {
        if (!current.current) return;
        setSaved(null);
        setPublicKey(issued.publicKey);
      },
      (cause: unknown) => {
        if (!(cause instanceof Error)) throw cause;
        if (current.current) setFault(text.keyFailed);
      },
    );
  };

  // Opens on the connected server. Otherwise it shows the key to connect one with, and asks for a
  // new key only when none is waiting.
  useEffect(() => {
    heldServerKey(project, name).then(
      (held) => {
        if (!current.current) return;
        if (held?.state === "bound")
          setSaved({ address: held.address!, publicKey: held.publicKey });
        else if (held?.state === "issued") {
          setSaved(null);
          setPublicKey(held.publicKey);
        } else {
          setSaved(null);
          issue({});
        }
      },
      (cause: unknown) => {
        if (!(cause instanceof Error)) throw cause;
        if (!current.current) return;
        // If the read fails, the form can only offer to connect a new server.
        setSaved(null);
        issue({});
        setFault(text.readFailed);
      },
    );
  }, [project, name]);

  const connect = async () => {
    if (saving || publicKey === undefined) return;
    const server = readServerAddress(address);
    if (server === undefined) {
      setFault(text.refused("invalid_address"));
      return;
    }
    setSaving(true);
    setFault(undefined);
    try {
      await connectServerKey(project, name, server);
      onSaved();
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      if (current.current) setFault(text.refused(cause.message));
    } finally {
      if (current.current) setSaving(false);
    }
  };

  const stage: ServerKeyStage =
    saved === undefined
      ? { step: "reading" }
      : saved !== null
        ? {
            step: "saved",
            saved,
            onUse: onSaved,
            onAnother: () => issue({}),
          }
        : {
            step: "new",
            publicKey,
            address,
            onAddress: setAddress,
            onConnect: () => void connect(),
            onNewKey: () => issue({ fresh: true }),
            saving,
          };
  return (
    <ServerKeyFormView
      about={declaration.about}
      stage={stage}
      fault={fault}
      onFault={setFault}
    />
  );
}
