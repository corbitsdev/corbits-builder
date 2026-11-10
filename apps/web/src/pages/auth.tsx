/**
 * Sign up or sign in against the hub directly; every session belongs to a
 * real account.
 */
import { useAuth, type AuthProps } from "./auth.model.ts";
import { AuthView } from "./auth.view.tsx";

export function Auth(props: AuthProps) {
  return <AuthView {...useAuth(props)} />;
}
