/**
 * The sign-in page as it looks: one form that signs in or signs up, and a
 * link to switch between the two.
 */
import { productName, wording } from "../config.ts";
import { AuthLayout, DitherCanvas, LoginForm } from "@corbits/react-ui";
import { Button, Mark } from "../components.jsx";

export type AuthMode = "sign-up" | "sign-in";

/** What the form hands over; a name only when signing up. */
export type Credentials = {
  readonly name?: string;
  readonly email: string;
  readonly password: string;
};

export type AuthViewProps = {
  /** Whether the form signs in or creates an account. */
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  /** A sign-in or sign-up is in flight; the form and the switch wait. */
  busy: boolean;
  /** Why the last attempt did not go through. */
  error: string | null;
  onSubmit: (credentials: Credentials) => void;
};

const text = wording.auth;

export function AuthView({
  mode,
  onModeChange,
  busy,
  error,
  onSubmit,
}: AuthViewProps) {
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
        onSubmit={onSubmit}
        footer={
          mode === "sign-up" ? (
            <>
              {text.haveAccount}{" "}
              <Button
                variant="link"
                disabled={busy}
                onClick={() => onModeChange("sign-in")}
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
                onClick={() => onModeChange("sign-up")}
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
