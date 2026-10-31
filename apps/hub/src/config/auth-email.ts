import type { ProductConfig } from "./index.ts";

export function verificationEmail(
  config: ProductConfig,
  address: string,
  link: string,
) {
  return {
    subject: `Verify your ${config.naming.productName} email`,
    text: [
      `Verify ${address} for ${config.naming.productName}: ${link}`,
      "This link expires in an hour. Ignore this email if you did not request it.",
    ].join("\n\n"),
  };
}

export function invitationEmail(
  config: ProductConfig,
  link: string,
  expiresAt: string,
) {
  return {
    subject: `Invitation to ${config.naming.productName}`,
    text: [
      `You have been invited to ${config.naming.productName}.`,
      "Sign up or sign in with this email address and a password, then verify your email before accepting.",
      `Your authenticated invitation API address is ${link}.`,
      "Reading this address does not sign you in or activate access. Use its /accept endpoint to accept explicitly.",
      `The invitation expires at ${expiresAt}. Ignore this message if you did not expect an invitation.`,
    ].join("\n\n"),
  };
}

export function passwordResetEmail(config: ProductConfig, link: string) {
  return {
    subject: `Reset your ${config.naming.productName} password`,
    text: [
      `Reset the password for your ${config.naming.productName} account: ${link}`,
      "This link expires soon and can be used once. Ignore this email if you did not request it.",
    ].join("\n\n"),
  };
}

export function magicLinkEmail(
  config: ProductConfig,
  address: string,
  link: string,
) {
  return {
    subject: `Sign in to ${config.naming.productName}`,
    text: [
      `Sign in to ${config.naming.productName} as ${address}: ${link}`,
      "This link expires in 15 minutes and can be used once. Ignore this email if you did not request it.",
    ].join("\n\n"),
  };
}
