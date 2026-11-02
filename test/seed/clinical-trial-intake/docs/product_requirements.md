# Product Requirements: Clinical Trial Patient Intake & Consent Portal

## Screens & Core Capabilities

1. **Coordinator Review Queue (`/`)**:
   - Summary metrics: Active referrals, eligible awaiting consent, re-consent required, and enrolled subjects vs target cohort size.
   - Filterable subject table by stage (`Referral`, `Screening`, `Consent Pending`, `PI Review`, `Enrolled`, `Screen Failed`), site, and consent status.
2. **Eligibility Screening Worksheet (`/screening`)**:
   - Structured inclusion checklist (Age 18–75, confirmed diagnosis, ECOG 0–1, baseline eGFR >= 45) and exclusion checklist.
   - Live eligibility verdict banner (`Eligible`, `Pending Labs`, `Excluded`).
3. **E-Consent & IRB Version Desk (`/consent`)**:
   - Active protocol version (`CARDIO-301 · IRB v3.2`), participant signature timestamp, interpreter witness field, and PI countersignature action.
   - Automatic `Re-consent Required` badge when signed version trails active protocol version.
4. **Immutable Audit Trail (`/audit`)**:
   - Chronological log of every criterion change, consent signature, and enrollment decision with actor, subject ID, and rationale.
