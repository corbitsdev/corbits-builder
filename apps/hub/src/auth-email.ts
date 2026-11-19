import { createTransport } from "nodemailer";
import { getLogger } from "@intx/log";
import {
  verificationEmail,
  invitationEmail,
  passwordResetEmail,
  magicLinkEmail,
} from "./config/auth-email.ts";
import type { ProductConfig } from "./config/index.ts";
import type { HubEnvironment } from "./environment.ts";
import { errorCode, requestErrorMetadata } from "./request-error.ts";

const log = getLogger(["corbits-builder", "auth-email"]);

export function createAuthEmail(
  environment: Pick<HubEnvironment, "SMTP_URL" | "EMAIL_FROM">,
  config: ProductConfig,
) {
  const { SMTP_URL, EMAIL_FROM } = environment;
  if (SMTP_URL === undefined || EMAIL_FROM === undefined) return undefined;
  const transport = createTransport(SMTP_URL, { from: EMAIL_FROM });
  const send = async (
    to: string,
    message: { subject: string; text: string },
    failure: string,
  ) => {
    try {
      await transport.sendMail({ to, ...message });
    } catch (error) {
      // Transport errors can contain mailbox addresses, URL credentials or tokens, so only their
      // code is kept.
      log.warn("Sending an email failed: {failure}", {
        failure,
        ...errorCode(error),
        ...requestErrorMetadata(error),
      });
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
