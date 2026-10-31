/**
 * Sign up or sign in against the hub directly; every session belongs to a
 * real account.
 */
import { productName, wording } from "../config.ts";
import { AuthLayout, DitherCanvas, LoginForm } from "@corbits/react-ui";
import { useState } from "react";
import { Button, Mark } from "../components.jsx";
import { signInHub, signUpHub } from "../api/auth.ts";

type Mode = "sign-up" | "sign-in";

const PASSWORD_MIN = 8;
const text = wording.auth;

export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (credentials: {
    name?: string;
    email: string;
    password: string;
  }) => {
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
          name: (credentials.name ?? "").trim(),
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

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <AuthLayout
      brand={
        <>
          <Mark size={22} />
          <span>{productName}</span>
        </>
      }
      panel={<DitherCanvas />}
    >
      <LoginForm
        key={mode}
        mode={mode}
        heading={mode === "sign-up" ? text.signUpHeading : text.signInHeading}
        busy={busy}
        error={error}
        onSubmit={(credentials) => void submit(credentials)}
        footer={
          mode === "sign-up" ? (
            <>
              {text.haveAccount}{" "}
              <Button
                variant="link"
                disabled={busy}
                onClick={() => switchTo("sign-in")}
              >
                {wording.action.signIn}
              </Button>
            </>
          ) : (
            <>
              {text.noAccount}{" "}
              <Button
                variant="link"
                disabled={busy}
                onClick={() => switchTo("sign-up")}
              >
                {text.createAccount}
              </Button>
            </>
          )
        }
      />
    </AuthLayout>
  );
}
