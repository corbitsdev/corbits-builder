/**
 * Signing up or in against the hub directly; every session belongs to a real
 * account.
 */
import { useState } from "react";
import { wording } from "../config.ts";
import { signInHub, signUpHub } from "../api/auth.ts";
import type { AuthMode, AuthViewProps, Credentials } from "./auth.view.tsx";

export type AuthProps = { onSignedIn: () => void };

const PASSWORD_MIN = 8;
const text = wording.auth;

export function useAuth({ onSignedIn }: AuthProps): AuthViewProps {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (credentials: Credentials) => {
    if (busy) return;
    if (credentials.password.length < PASSWORD_MIN) {
      setError(text.passwordTooShort(PASSWORD_MIN));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const email = credentials.email.trim();
      if (mode === "sign-up") {
        await signUpHub({
          email,
          password: credentials.password,
          ...(credentials.name === undefined
            ? {}
            : { name: credentials.name.trim() }),
        });
      } else {
        await signInHub({ email, password: credentials.password });
      }
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return {
    mode,
    onModeChange: (next) => {
      setMode(next);
      setError(null);
    },
    busy,
    error,
    onSubmit: (credentials) => void submit(credentials),
  };
}
