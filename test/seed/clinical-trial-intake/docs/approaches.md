# Approaches: Clinical Trial Patient Intake & Consent Portal

## Option 1: Rule-Checked Coordinator Workbench with Append-Only Audit Ledger (Recommended)

A multi-view coordinator portal backed by structured inclusion/exclusion rule evaluation, protocol consent version checks, and an append-only SQLite audit log.

## Option 2: Static Form Wizard with PDF Upload Only

A simple linear intake form that stores uploaded PDF filenames without structured criterion-level evaluation.

## Option 3: External BPMN Workflow Engine Integration

Delegate state transitions to an external BPMN microservice and render generic task forms.
