# Security Policy

## Supported versions

Only the latest minor release line is supported with security updates.

| Version              | Supported |
| -------------------- | --------- |
| `0.x` (latest minor) | ✅        |
| older                | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via one of:

1. GitHub's [private vulnerability reporting form](https://github.com/Abbosbek-cloud/tiny-fetch/security/advisories/new) (preferred).
2. Email <abek01sulaymonov@gmail.com> with the subject line `[tiny-fetch security]`.

Please include:

- A clear description of the issue and its impact
- Steps to reproduce (minimal PoC if possible)
- Affected version(s)
- Any suggested mitigation

### What to expect

- **Acknowledgement** within 72 hours.
- **Triage & severity assessment** within 7 days.
- A coordinated fix, release, and public advisory — we'll agree on a disclosure timeline with you before publishing.

## Supply chain

- Published releases include **npm provenance** attestations, verifiable via `npm audit signatures`.
- Releases are built and published exclusively from GitHub Actions — never from a maintainer laptop.
- The library has **zero runtime dependencies**, minimising third-party risk.
