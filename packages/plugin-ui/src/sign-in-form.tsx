/**
 * A form that signs the person in at a plugin's provider, in place of pasting a key. The hub starts
 * the sign-in, the provider's page opens in a new tab, and the form waits until the hub has saved
 * the provider's token in the project. It shows which account a saved sign-in connected, and lets
 * the person sign in again or disconnect. No token reaches the browser.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button, ConfirmButton } from "@corbits/react-ui";
import type { HttpCredentialDeclaration } from "@corbits-builder/plugin";
import {
  cancelSignIn,
  disconnectSignIn,
  followSignIn,
  savedSignIn,
  SIGN_IN_DEADLINE_MS,
  startSignIn,
  type SavedSignIn,
  type SignInEnd,
} from "./sign-in.ts";
import styles from "./sign-in-form.module.css";

export type SignInFormProps = {
  /** The credential's name as its plugin declares it. */
  name: string;
  declaration: HttpCredentialDeclaration;
  /** A sign-in belongs to the project only, because a token that can spend money is not shared
   * across a workspace. */
  tenants: { project: string };
  onSaved: () => void;
  /** A line the plugin's screen shows above Disconnect, such as what still costs money there. */
  warning?: string;
};

const text = {
  reading: "Reading your sign-in…",
  signIn: "Sign in",
  signInHint:
    "The sign-in page opens in a new tab. Come back to this one once you've signed in.",
  signedOut:
    "The provider stopped accepting this sign-in. Sign in again to keep going.",
  waiting: "Waiting for you to sign in…",
  openAgain: "Open the sign-in page again",
  cancel: "Cancel",
  signedInAs: (account: string) => `Signed in as ${account}`,
  signedIn: "Signed in",
  use: "Use this account",
  signInAgain: "Sign in again",
  disconnect: "Disconnect",
  confirmDisconnect: "Yes, disconnect",
  disconnecting: "Disconnecting…",
  providerMayHold:
    "Disconnected here. The provider may still hold the sign-in: remove it in your account there.",
  readFailed: "Your sign-in could not be read. Try again in a moment.",
  failed: (code: string): string => {
    switch (code) {
      case "sign_in_refused":
        return "The sign-in was cancelled at the provider.";
      case "sign_in_other_session":
        return "The sign-in came back to a browser that is not signed in as you. Sign in again from this browser.";
      case "sign_in_expired":
      case "late":
        return "The sign-in took too long. Try again.";
      case "sign_in_replaced":
        return "A newer sign-in took this one's place.";
      case "sign_in_unregistered":
        return "The provider is not taking sign-ins right now. Try again later.";
      default:
        return "Not signed in. Try again in a moment.";
    }
  },
  notDisconnected: "Not disconnected. Try again in a moment.",
};

/** What the form shows: reading the saved sign-in, no sign-in saved (or the provider stopped
 * accepting it), the person signing in on the provider's tab, or a saved sign-in. */
export type SignInStage =
  | { step: "reading" }
  | {
      step: "signedOut";
      /** A saved sign-in the provider no longer accepts. */
      lapsed: boolean;
      onSignIn: () => void;
      starting: boolean;
    }
  | { step: "waiting"; url: string; onCancel: () => void }
  | {
      step: "signedIn";
      account: string | undefined;
      onUse: () => void;
      onSignInAgain: () => void;
      onDisconnect: () => void;
      starting: boolean;
      disconnecting: boolean;
    };

export type SignInFormViewProps = {
  /** What the credential is for, as its plugin declares it: the form's name. */
  about: string;
  stage: SignInStage;
  /** What the person should know before disconnecting; shown only while signed in. */
  warning: string | undefined;
  /** Why the last step did not work, or what it left to do. */
  fault: string | undefined;
};

/** How the form looks in each stage, drawn from its props alone. */
export function SignInFormView({
  about,
  stage,
  warning,
  fault,
}: SignInFormViewProps) {
  const id = useId();
  const faultLine =
    fault === undefined ? null : (
      <p className={styles.fault} role="alert">
        {fault}
      </p>
    );
  if (stage.step === "reading")
    return (
      <div className={styles.form} data-slot="sign-in-form">
        <p className={styles.hint} role="status">
          {text.reading}
        </p>
        {faultLine}
      </div>
    );
  if (stage.step === "waiting")
    return (
      <section
        className={styles.form}
        data-slot="sign-in-form"
        aria-label={about}
        aria-busy
      >
        <p className={styles.hint} role="status">
          {text.waiting}
        </p>
        {/* If the browser blocked the new tab, the person can open the link themselves. */}
        <a
          className={styles.link}
          href={stage.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text.openAgain}
        </a>
        {faultLine}
        <div className={styles.actions}>
          <Button type="button" variant="outline" onClick={stage.onCancel}>
            {text.cancel}
          </Button>
        </div>
      </section>
    );
  if (stage.step === "signedOut")
    return (
      <section
        className={styles.form}
        data-slot="sign-in-form"
        aria-label={about}
        aria-busy={stage.starting}
      >
        <p id={`${id}-hint`} className={styles.hint}>
          {stage.lapsed ? text.signedOut : text.signInHint}
        </p>
        {faultLine}
        <div className={styles.actions}>
          <Button
            type="button"
            aria-describedby={`${id}-hint`}
            disabled={stage.starting}
            onClick={stage.onSignIn}
          >
            {stage.lapsed ? text.signInAgain : text.signIn}
          </Button>
        </div>
      </section>
    );
  const busy = stage.starting || stage.disconnecting;
  return (
    <section
      className={styles.form}
      data-slot="sign-in-form"
      aria-label={about}
      aria-busy={busy}
    >
      <p className={styles.account}>
        {stage.account === undefined
          ? text.signedIn
          : text.signedInAs(stage.account)}
      </p>
      {faultLine}
      <div className={styles.actions}>
        <Button type="button" disabled={busy} onClick={stage.onUse}>
          {text.use}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={stage.onSignInAgain}
        >
          {text.signInAgain}
        </Button>
      </div>
      {warning === undefined ? null : (
        <p className={styles.warning}>{warning}</p>
      )}
      <div className={styles.actions}>
        {/* Disconnecting takes a second, deliberate press. */}
        <ConfirmButton
          variant="ghost"
          disabled={busy}
          confirmLabel={text.confirmDisconnect}
          onConfirm={stage.onDisconnect}
        >
          {stage.disconnecting ? text.disconnecting : text.disconnect}
        </ConfirmButton>
      </div>
    </section>
  );
}

export function SignInForm({
  name,
  declaration,
  tenants,
  onSaved,
  warning,
}: SignInFormProps) {
  // Undefined while reading; null when the project has no sign-in.
  const [saved, setSaved] = useState<SavedSignIn | null>();
  const [waiting, setWaiting] = useState<{ id: string; url: string }>();
  const [starting, setStarting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fault, setFault] = useState<string>();
  // Aborts following a sign-in when the form unmounts or the person cancels.
  const following = useRef<AbortController>(undefined);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
      following.current?.abort();
    };
  }, []);

  useEffect(() => {
    savedSignIn(tenants.project, name).then(
      (read) => {
        if (current.current) setSaved(read ?? null);
      },
      (cause: unknown) => {
        if (!(cause instanceof Error)) throw cause;
        if (!current.current) return;
        // If the read fails, the form can only offer to sign in.
        setFault(text.readFailed);
        setSaved(null);
      },
    );
  }, [tenants.project, name]);

  const ended = (end: SignInEnd) => {
    if (end.status === "done") {
      onSaved();
      return;
    }
    if (end.status === "cancelled") return;
    setFault(text.failed(end.status === "failed" ? end.code : end.status));
  };

  const signIn = async () => {
    if (starting || waiting !== undefined) return;
    setStarting(true);
    setFault(undefined);
    let started: { id: string; url: string };
    try {
      started = await startSignIn(tenants.project, name);
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      if (current.current) {
        setFault(text.failed(cause.message));
        setStarting(false);
      }
      return;
    }
    window.open(started.url, "_blank", "noopener");
    if (!current.current) return;
    setStarting(false);
    setWaiting(started);
    const controller = new AbortController();
    following.current = controller;
    try {
      const end = await followSignIn(tenants.project, started.id, {
        deadline: Date.now() + SIGN_IN_DEADLINE_MS,
        signal: controller.signal,
      });
      if (current.current) ended(end);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (!(cause instanceof Error)) throw cause;
      if (current.current) setFault(text.failed(cause.message));
    } finally {
      if (current.current) setWaiting(undefined);
    }
  };

  const cancel = () => {
    if (waiting === undefined) return;
    following.current?.abort();
    setWaiting(undefined);
    // The hub stops waiting too, so a code the provider sends now is not exchanged.
    cancelSignIn(tenants.project, waiting.id).catch((cause: unknown) => {
      if (!(cause instanceof Error)) throw cause;
    });
  };

  const disconnect = async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    setFault(undefined);
    try {
      const { code } = await disconnectSignIn(tenants.project, name);
      if (!current.current) return;
      setSaved(null);
      if (code === "provider_may_hold_grant") setFault(text.providerMayHold);
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      if (current.current) setFault(text.notDisconnected);
    } finally {
      if (current.current) setDisconnecting(false);
    }
  };

  const stage: SignInStage =
    waiting !== undefined
      ? { step: "waiting", url: waiting.url, onCancel: cancel }
      : saved === undefined
        ? { step: "reading" }
        : saved === null || saved.signedOut
          ? {
              step: "signedOut",
              lapsed: saved?.signedOut ?? false,
              onSignIn: () => void signIn(),
              starting,
            }
          : {
              step: "signedIn",
              account: saved.account,
              onUse: onSaved,
              onSignInAgain: () => void signIn(),
              onDisconnect: () => void disconnect(),
              starting,
              disconnecting,
            };
  return (
    <SignInFormView
      about={declaration.about}
      stage={stage}
      warning={warning}
      fault={fault}
    />
  );
}
