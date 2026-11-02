---
name: "Clinical Trial Patient Intake & Consent Portal (Rounded enterprise)"
colors:
  background: "#f8fafc"
  foreground: "#0f172a"
  card: "#ffffff"
  card-foreground: "#0f172a"
  popover: "#ffffff"
  popover-foreground: "#0f172a"
  primary: "#1d5bd6"
  primary-foreground: "#ffffff"
  primary-active: "#1646a8"
  secondary: "#eff4fb"
  secondary-foreground: "#0f172a"
  muted: "#f1f5f9"
  muted-foreground: "#475569"
  accent: "#e6effd"
  accent-foreground: "#1646a8"
  destructive: "#c81e1e"
  destructive-foreground: "#ffffff"
  success: "#def7ec"
  success-foreground: "#03543f"
  warning: "#fdf6b2"
  warning-foreground: "#723b13"
  border: "#e2e8f0"
  input: "#cbd5e1"
  ring: "#1d5bd6"
  dark-background: "#0b1120"
  dark-foreground: "#f1f5f9"
  dark-card: "#131c31"
  dark-card-foreground: "#f1f5f9"
  dark-popover: "#1b2742"
  dark-popover-foreground: "#f1f5f9"
  dark-primary: "#60a5fa"
  dark-primary-foreground: "#0b1120"
  dark-primary-active: "#93c5fd"
  dark-secondary: "#1e293b"
  dark-secondary-foreground: "#f1f5f9"
  dark-muted: "#1e293b"
  dark-muted-foreground: "#94a3b8"
  dark-accent: "#1e3a8a"
  dark-accent-foreground: "#dbeafe"
  dark-destructive: "#f87171"
  dark-destructive-foreground: "#0b1120"
  dark-success: "#064e3b"
  dark-success-foreground: "#6ee7b7"
  dark-warning: "#451a03"
  dark-warning-foreground: "#fde68a"
  dark-border: "#263554"
  dark-input: "#334155"
  dark-ring: "#60a5fa"
typography:
  font-sans:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  font-mono:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
rounded:
  radius: "1rem"
  radius-sm: "12px"
  radius-lg: "20px"
---

# Clinical Trial Patient Intake & Consent Portal (Rounded enterprise)

## Summary

A calm, high-trust clinical research workbench with rounded cards, clear semantic badges for IRB consent versions, and a structured four-destination navigation bar.

## Screens

### Queue

- Route: `/` (mockup `#/queue`)
- States: `populated`, `empty`
- Test ids: `queue-title`, `protocol-banner`, `candidate-table`, `candidate-detail`

### Screening

- Route: `/screening` (mockup `#/screening`)
- States: `populated`
- Test ids: `screening-title`, `inclusion-list`, `exclusion-list`

### Consent

- Route: `/consent` (mockup `#/consent`)
- States: `populated`
- Test ids: `consent-title`, `consent-version-card`

### Audit

- Route: `/audit` (mockup `#/audit`)
- States: `populated`
- Test ids: `audit-title`, `audit-table`
