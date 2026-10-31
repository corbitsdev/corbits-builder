import {
  createIsogitStore,
  createMailAuditStore,
  listMail,
} from "@intx/storage-isogit/node";
import { decodeMail, extractAddrSpec } from "@intx/mime";
import { verifyMimeSignature } from "@intx/mailbox";
import { hexDecode } from "@intx/types";
import { ProjectError } from "./errors.ts";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import type { SidecarLookups } from "@intx/hub-sessions";
import { ProjectId } from "@corbits-builder/schemas/project";

// Archives delivered workflow mail frames; native routing/admission still owns delivery.
export function createWorkflowMailPersistence(options: {
  db: DB["db"];
  directory: string;
}): NonNullable<SidecarLookups["persistMail"]> {
  return async (input) => {
    const decoded = decodeMail(input.raw);
    const sender = await options.db.query.workflowRun.findFirst({
      where: eq(workflowRun.address, input.senderAddress),
    });
    if (
      !sender?.publicKey ||
      !decoded.headers.from ||
      extractAddrSpec(decoded.headers.from)?.toLowerCase() !==
        input.senderAddress.toLowerCase() ||
      (await verifyMimeSignature(input.raw, hexDecode(sender.publicKey))) !==
        "valid"
    )
      throw new ProjectError(403, "mail_sender_signature_refused");
    const retain = async (runId: string, direction: "in" | "out") => {
      const directory = join(options.directory, ProjectId.assert(runId));
      await createIsogitStore(directory);
      const journal = await createMailAuditStore(directory);
      const commit = await journal.commitMail(input.raw, direction, {
        ignoreDuplicate: true,
      });
      if (commit === null) {
        const prior = (await listMail(directory)).find(
          (item) => item.messageId === decoded.headers.messageId,
        );
        const digest = (raw: Uint8Array) =>
          new Bun.CryptoHasher("sha256").update(raw).digest("hex");
        if (!prior || digest(prior.raw) !== digest(input.raw))
          throw new ProjectError(409, "mail_message_identity_reuse");
      }
    };
    await retain(sender.id, "out");
    for (const recipient of input.recipients) {
      const run = await options.db.query.workflowRun.findFirst({
        where: eq(workflowRun.address, recipient),
      });
      if (run) await retain(run.id, "in");
    }
    return [];
  };
}
