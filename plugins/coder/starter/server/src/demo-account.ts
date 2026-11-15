import { z } from "zod";
import account from "./data/demo-account.json";

// The account a person signs in with to try the app; Live Preview shows it beside the app.
export const demoAccount = z
  .object({ email: z.email(), password: z.string().min(1) })
  .parse(account);
export type DemoAccount = typeof demoAccount;

// Creates the demo account in the app's own account store on first run and leaves it as it is after.
export async function seedDemoAccount(accounts: {
  has: (email: string) => boolean | Promise<boolean>;
  create: (account: DemoAccount) => unknown;
}) {
  if (!(await accounts.has(demoAccount.email)))
    await accounts.create(demoAccount);
}
