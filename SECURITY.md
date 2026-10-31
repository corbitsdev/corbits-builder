# Security Policy

## Reporting a Vulnerability

Please report security issues through [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository (Security tab → Report a vulnerability).

Do not open a public issue for security reports.

We will acknowledge reports as soon as practical and work with you on a fix and
disclosure timeline.

## Scope Notes

Builder runs model-driven agents that write documents and build code in a
sandbox, and gates their decisions behind human approval of an exact version.
Treat any way around those boundaries as security-relevant, including:

- an approval recorded without the person's action, or applied to a version or
  content hash other than the one they approved
- a model provider key, encryption key, session or any vaulted credential
  exposed through a response, log, artifact or prompt
- an agent or workflow reaching a tool, grant or credential it was never given
- the coder's sandbox reaching files or network outside its policy
- one workspace reading or changing another workspace's projects or settings

When reporting, include:

- Builder version or commit
- Steps to reproduce
- Expected vs actual behavior
- Whether the issue requires a malicious prompt, uploaded file, or
  configuration
