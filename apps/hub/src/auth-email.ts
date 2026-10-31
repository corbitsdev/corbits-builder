import { createTransport } from "nodemailer";
import {
  verificationEmail,
  invitationEmail,
  passwordResetEmail,
  magicLinkEmail,
} from "./config/auth-email.ts";
import type { ProductConfig } from "./config/index.ts";
import type { Environment } from "./environment.ts";

export function createAuthEmail(
  environment: Environment,
  config: ProductConfig,
) {
  const smtpUrl = environment["SMTP_URL"]?.trim() || undefined;
  const from = environment["EMAIL_FROM"]?.trim() || undefined;
  if (smtpUrl === undefined && from === undefined) return undefined;
  if (!smtpUrl || !from)
    throw new Error("SMTP_URL and EMAIL_FROM must be configured together");
  let url: URL;
  try {
    url = new URL(smtpUrl);
  } catch {
    throw new Error("SMTP_URL must be an smtp:// or smtps:// URL");
  }
  if (
    !["smtp:", "smtps:"].includes(url.protocol) ||
    !url.hostname ||
    /\s/.test(smtpUrl)
  )
    throw new Error("SMTP_URL must be an smtp:// or smtps:// URL");
  if (["\r", "\n", "\0"].some((character) => from.includes(character)))
    throw new Error("EMAIL_FROM must be one line");
  const transport = createTransport(smtpUrl, { from });
  const send = async (
    to: string,
    message: { subject: string; text: string },
    failure: string,
  ) => {
    try {
      await transport.sendMail({ to, ...message });
    } catch {
      // Transport errors can contain mailbox addresses, URL credentials or tokens.
      throw new Error(failure);
    }
  };
  return {
    async verifyEmail(to: string, link: string) {
      await send(
        to,
        verificationEmail(config, to, link),
        "verification_email_delivery_failed",
      );
    },
    async resetPassword(to: string, link: string) {
      await send(
        to,
        passwordResetEmail(config, link),
        "password_reset_email_delivery_failed",
      );
    },
    async magicLink(to: string, link: string) {
      await send(
        to,
        magicLinkEmail(config, to, link),
        "magic_link_email_delivery_failed",
      );
    },
    async notifyInvitation(to: string, link: string, expiresAt: string) {
      await send(
        to,
        invitationEmail(config, link, expiresAt),
        "invitation_email_delivery_failed",
      );
    },
    close: () => transport.close(),
  };
}
