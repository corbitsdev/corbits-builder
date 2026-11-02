# Build Plan: Clinical Trial Patient Intake & Consent Portal

## Architecture & Database Schema

- `trial_protocols`: `id`, `code`, `title`, `active_consent_version`, `target_enrollment`.
- `candidates`: `id`, `subject_code`, `initials`, `site_name`, `stage`, `eligibility_status`, `signed_consent_version`, `pi_Countersigned_at`.
- `screening_checks`: `id`, `candidate_id`, `criterion_code`, `category` (`inclusion` | `exclusion`), `label`, `status` (`pass` | `fail` | `pending`), `notes`.
- `audit_events`: `id`, `candidate_id`, `subject_code`, `actor_name`, `actor_role`, `action`, `detail`, `created_at`.

## API Endpoints

- `GET /api/intake/overview`: Returns protocol metadata, candidates with computed eligibility & consent flags, and KPI counts.
- `POST /api/candidates/:id/screening`: Updates a screening criterion and records an audit event.
- `POST /api/candidates/:id/consent`: Records participant e-consent or PI countersignature for the active protocol version.
- `POST /api/candidates/:id/enroll`: Validates all 4 enrollment gates (inclusion pass, exclusion clear, active consent version, PI countersignature) and transitions candidate to `Enrolled`.
- `GET /api/audit`: Lists immutable audit trail entries with subject and action filters.

## Acceptance Checklist

- [ ] Coordinator queue displays candidates with eligibility status, signed consent version, and re-consent warnings.
- [ ] Updating an inclusion or exclusion criterion recalculates candidate eligibility and appends an audit event.
- [ ] Enrollment is refused with a clear reason until all criteria pass and active IRB consent is countersigned.
- [ ] Audit trail view filters chronological events by subject code and action type.
