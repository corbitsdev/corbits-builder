import { type } from "arktype";
import { ProjectId } from "./project.ts";

// Preserve PostgreSQL microseconds: a millisecond Date cursor can skip events.
const AuditCursor = type({
  "+": "reject",
  occurredAt: /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
  id: ProjectId,
});
export const AuditQuery = type({
  "+": "reject",
  "before?": AuditCursor,
  "limit?": "1 <= number.integer <= 100",
});
export type AuditQuery = typeof AuditQuery.infer;
export const AuditEventType = type(
  "'project.created' | 'project.updated' | 'project.archived' | 'project.restored' | 'project.coordinator.bound' | 'artifact.version.created' | 'artifact.sources.declared' | 'artifact.write.refused' | 'artifact.decision.recorded' | 'artifact.review.issued' | 'artifact.review.revoked' | 'writer.report.received' | 'settings.saved' | 'upload.text.delivered' | 'upload.read.acknowledged' | 'upload.classification.proposed' | 'upload.classification.accepted' | 'upload.classifier.bound' | 'upload.recipient.delegated' | 'build.gate.reserved' | 'build.gate.observed' | 'unclassified'",
);
export const ProjectAuditPage = type({
  "+": "reject",
  events: AuditCursor.merge({ "+": "reject", eventType: AuditEventType })
    .array()
    .atMostLength(100),
  nextCursor: AuditCursor.or("null"),
  coverage: "'persisted_product_events'",
  payloads: "'withheld'",
});
export type ProjectAuditPage = typeof ProjectAuditPage.infer;
