# Repository Instructions

## Package management

- Use **pnpm** for this repository.
- Respect `packageManager` in `package.json` and commit `pnpm-lock.yaml`.
- Do not generate or commit `package-lock.json`, `yarn.lock`, or `bun.lock`.
- Do not switch package managers without explicit approval.
- Prefer existing dependencies/platform capabilities before adding a new package.

## Verification

Before claiming a change is ready, run the relevant checks when available:

```bash
pnpm lint
pnpm test
pnpm build
```

Do not claim checks passed if they were not run.
