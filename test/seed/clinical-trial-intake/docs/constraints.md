# Constraints: Clinical Trial Patient Intake & Consent Portal

## Regulatory & Data Integrity Constraints

- **Immutable audit events**: Every screening answer change, consent signature, re-consent request, and PI sign-off appends an immutable audit event with actor role, timestamp, and reason.
- **Consent version pinning**: Each candidate's consent record binds to an explicit IRB protocol version (e.g. `IRB-2026-v3.2`). If the active protocol version advances, candidates in `Screening` or `Awaiting Baseline` with an older version are automatically marked `Re-consent Required`.
- **No unmasked PHI in summary banners**: Candidate cards display study subject IDs (e.g. `SUBJ-2041`) and initials alongside clinic site codes.

## Workflow Constraints

- A candidate cannot transition to `Enrolled` unless:
  1. All Inclusion criteria pass,
  2. All Exclusion criteria are cleared,
  3. E-consent is signed on the current active protocol version, and
  4. PI countersignature is recorded.
