# Problem Brief: Clinical Trial Patient Intake & Consent Portal

## Problem Statement

Clinical research sites running Phase II/III oncology and cardiology trials lose eligible candidates and risk protocol deviations when intake coordinators screen referrals across paper worksheets, disconnected PDF consent forms, and spreadsheets. Coordinators need a single structured portal to evaluate inclusion/exclusion criteria, verify that candidates sign the active IRB-approved consent version, and record every eligibility decision in an immutable audit log.

## Target Users

- **Study Coordinator (CRC)**: Screens referred candidates, records lab and medical history criteria, tracks e-consent signatures, and schedules baseline visits.
- **Principal Investigator (PI) / Sub-Investigator**: Reviews borderline eligibility cases, countersigns e-consent packets, and signs off on enrollment readiness.
- **Clinical Quality Monitor**: Inspects the protocol version history and timestamped audit trail for each candidate.

## Core Outcomes

1. Deterministic inclusion/exclusion rule evaluation with explicit coordinator override notes when PI review is required.
2. Protocol consent version locking so candidates on an superseded IRB amendment are flagged for re-consent before enrollment.
3. Complete, filterable audit trail naming who recorded or approved every screening and consent step.
