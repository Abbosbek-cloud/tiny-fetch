# Contributing

Thanks for your interest in improving **tiny-fetch**. This guide covers the dev loop, conventions, and how releases work.

## Dev setup

Requires **Node >= 20** and **npm >= 10**.

```sh
git clone https://github.com/Abbosbek-cloud/tinyfetch.git
cd tinyfetch
npm ci
```

## Daily loop

```sh
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/ (ESM + CJS + .d.ts / .d.cts)
npm test            # vitest
npm run lint        # eslint + prettier (read-only check)
```

Before opening a PR, run them all. CI enforces the same checks on Node 20 and 22.

## Project layout

```
src/
  index.ts      public entry — only re-exports
  client.ts     HttpClient implementation
test/           vitest unit tests
dist/           build output (gitignored)
```

Keep the public surface minimal. New features should be additive and land behind clear type boundaries in `src/index.ts`.

## Design principles

- **Zero runtime dependencies.** A runtime dep needs a compelling reason; dev deps are fine.
- **Axios-compatible where cheap.** Response/error shapes and interceptor signatures should not drift.
- **Tree-shakeable.** `sideEffects: false` must stay true. Don't introduce module-level side effects.
- **Small surface.** If something can be a 10-line recipe in the README, prefer that over a built-in.
- **Works in the browser and Node 20+.** Runtime-feature-detect anything that isn't in both.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `build:`, `ci:`).
- **Types**: strict. No `any` in public API. `unknown` + narrowing is preferred.
- **No comments** explaining _what_ code does — only _why_ when non-obvious.
- **Tests**: every bugfix ships with a failing test first; every feature ships with tests for the happy path and at least one edge case.

## Adding a changeset (required for user-facing PRs)

Releases are managed by [Changesets](https://github.com/changesets/changesets). When your change affects published behaviour (feature, fix, breaking change, or any API-visible refactor), add a changeset:

```sh
npx changeset
```

Answer the prompts (bump type: `patch` / `minor` / `major`; summary). Commit the generated `.md` file in `.changeset/` alongside your code. PRs without a required changeset will fail CI.

Purely internal changes (build config, CI, tests, private refactors) don't need a changeset — mark them with `chore:` and skip the step.

## Release process

1. PR with code + changeset merges to `main`.
2. The `release` workflow opens (or updates) a **"Version Packages"** PR that bumps `package.json` and updates `CHANGELOG.md`.
3. Merging that PR triggers a publish to npm with **provenance** attestation.

Maintainers do not publish manually from their laptops.

## Reporting bugs

Open an issue with a minimal reproduction. For security problems, see [SECURITY.md](./SECURITY.md) instead — do **not** use public issues.
