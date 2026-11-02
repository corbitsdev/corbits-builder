---
name: "Field Service Dispatch Board (Modern and sleek)"
colors:
  background: "#fafafa"
  foreground: "#18181b"
  card: "#ffffff"
  card-foreground: "#18181b"
  popover: "#ffffff"
  popover-foreground: "#18181b"
  primary: "#2747d6"
  primary-foreground: "#ffffff"
  primary-active: "#1d37b0"
  secondary: "#f1f1f3"
  secondary-foreground: "#18181b"
  muted: "#f1f1f3"
  muted-foreground: "#5f5f68"
  accent: "#eef1fd"
  accent-foreground: "#1d37b0"
  destructive: "#c42b2b"
  destructive-foreground: "#ffffff"
  success: "#e3f4ea"
  success-foreground: "#17603a"
  warning: "#fdf1dc"
  warning-foreground: "#8a5300"
  border: "#e4e4e7"
  input: "#c9c9cf"
  ring: "#2747d6"
  dark-background: "#0b0b0d"
  dark-foreground: "#f4f4f5"
  dark-card: "#151518"
  dark-card-foreground: "#f4f4f5"
  dark-popover: "#1c1c20"
  dark-popover-foreground: "#f4f4f5"
  dark-primary: "#7089ff"
  dark-primary-foreground: "#0b0b0d"
  dark-primary-active: "#8ea1ff"
  dark-secondary: "#222227"
  dark-secondary-foreground: "#f4f4f5"
  dark-muted: "#1c1c20"
  dark-muted-foreground: "#a1a1aa"
  dark-accent: "#1d2240"
  dark-accent-foreground: "#b9c5ff"
  dark-destructive: "#f07272"
  dark-destructive-foreground: "#0b0b0d"
  dark-success: "#12301f"
  dark-success-foreground: "#8fdcae"
  dark-warning: "#36270c"
  dark-warning-foreground: "#f2c46d"
  dark-border: "#27272c"
  dark-input: "#3f3f46"
  dark-ring: "#7089ff"
typography:
  font-sans:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  font-mono:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
rounded:
  radius: "0.625rem"
  radius-sm: "8px"
  radius-lg: "14px"
---

# Field Service Dispatch Board (Modern and sleek)

## Summary

A high-clarity operational dispatch desk with cool zinc neutrals, cobalt selection highlights, and tabular SLA timers.

## Screens

### Dispatch

- Route: `/` (mockup `#/dispatch`)
- States: `populated`, `empty`
- Test ids: `dispatch-title`, `sla-alert-banner`, `work-order-table`, `work-order-detail`

### Technicians

- Route: `/technicians` (mockup `#/technicians`)
- States: `populated`
- Test ids: `technicians-title`, `technicians-grid`
