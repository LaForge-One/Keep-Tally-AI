# TypeScript Build Cleanup

This document records the TypeScript cleanup pass for KeepTally.

## Problem

The project was organized into packages, but the typecheck workflow was not receiving the full benefit of that modular structure. Several packages still used plain `tsc -p`, while some libraries used `tsc -b --force`, which rebuilt packages even when nothing changed.

The practical effect was:

- Typechecks timed out.
- The output stayed quiet for long periods.
- Developers could not tell whether TypeScript was stuck, slow, or finding real errors.
- Full checks were being used where targeted checks were enough.

## What Changed

### Project References

The root `tsconfig.json` now references:

- `lib/db`
- `lib/api-client-react`
- `lib/api-zod`
- `lib/integrations-openai-ai-server`
- `scripts`
- `artifacts/api-server`
- `artifacts/keep-tally`

This lets `tsc --build` reason over the whole workspace as a project graph.

### Incremental Build Info

Artifact and script packages now use:

```json
"composite": true,
"incremental": true,
"tsBuildInfoFile": "dist/tsconfig.tsbuildinfo"
```

The result is that the first run may still pay the cost of reading and resolving dependencies, but repeat runs can skip unchanged work.

### No-Emit Artifact Checks

The API server, web app, and scripts now typecheck without emitting declarations. Runtime builds remain handled by their existing build tools.

This avoids declaration portability errors from Express router inference and keeps typecheck from modifying runtime output.

### Library Checks No Longer Force Rebuilds

Library package scripts no longer use `--force` by default.

Before:

```text
tsc -b tsconfig.json --force
```

After:

```text
tsc -b tsconfig.json
```

Use the root `typecheck:full` command when a forced release-grade rebuild is needed.

### Typed Package Exports

Frontend-facing libraries now expose declaration boundaries:

- `@workspace/api-client-react`
- `@workspace/integrations-openai-ai-react`

This keeps consumers from unnecessarily walking source files when declaration files are available.

### Browser Type Scope

The web app no longer loads Node types in its browser `src` typecheck. It only loads:

```json
"types": ["vite/client"]
```

Node types are still available to Vite config through its own tooling path.

### pnpm Script Startup

The workspace now sets `verifyDepsBeforeRun: false` in `pnpm-workspace.yaml`. This prevents pnpm 11 from trying to run an automatic dependency install before scripts in environments where `corepack pnpm` works but a bare `pnpm` binary is not on `PATH`.

## Commands

Fast normal check:

```bash
corepack pnpm run typecheck
```

Target API check:

```bash
corepack pnpm run typecheck:api
```

Target web check:

```bash
corepack pnpm run typecheck:web
```

Bounded diagnostic check:

```bash
corepack pnpm run typecheck:bounded
```

Profiling check:

```bash
corepack pnpm run typecheck:profile
```

Release-grade forced check:

```bash
corepack pnpm run typecheck:full
```

## Results From This Pass

Observed after incremental build info was created:

| Target | Result |
| --- | --- |
| `scripts` | Passed in about 0.6 seconds after cache. |
| `api-server` | Passed in about 1 second after cache. |
| `keep-tally-web` | First clean pass took about 84 seconds; repeat pass took about 0.01 seconds. |
| root `tsc --build` | Passed in under 1 second after cache. |
| `corepack pnpm run typecheck` | Passed after disabling pnpm's pre-run dependency verification. |

The web app's first pass is still heavy because it resolves a large React/Radix/TanStack dependency surface. The important improvement is that repeat checks now use TypeScript's project cache instead of timing out.

## Remaining Bottleneck

The frontend's first uncached check still spends most of its time in file I/O and dependency resolution, not actual type checking.

Observed web first-pass profile:

```text
I/O Read time: about 64 seconds
ResolveModule time: about 7 seconds
ResolveTypeReference time: about 7 seconds
Check time: about 3 seconds
```

This means the next optimization should reduce dependency surface area, not relax type safety.

Recommended next steps:

- Split large pages into smaller modules where practical.
- Avoid importing full generated API surfaces when only a few hooks/types are needed.
- Consider a dedicated `ui` package only if it reduces repeated dependency resolution.
- Keep React/Radix components imported directly and avoid broad barrel files for UI components.
- Keep `skipLibCheck` enabled.

## Relationship To Database Caching

This cleanup improves development and deployment checks. It does not directly improve runtime database speed.

Runtime speed should be addressed separately through the database cache plan:

- Short-lived API cache for account/location/item reads.
- React Query invalidation after writes.
- Account-scoped cache keys.
- Redis only when multiple containers/workers require shared state.
