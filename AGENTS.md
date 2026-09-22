# Portfolio Agent Instructions

Repository-specific invariants for the Nova Hoang Portfolio. Workspace `AGENTS.md` and `WORKFLOW.md` still apply; do not duplicate their generic rules here.

## Project

Angular 22 + TypeScript + SCSS portfolio/CV site using pnpm, Vitest, and Firebase Hosting Classic. Production output: `dist/portfolio/browser`.

Preserve accurate professional content, responsive/accessibile UI, performance/SEO, and reviewed downloadable CV PDFs.

## Package management

Use **pnpm only**. `pnpm-lock.yaml` is canonical. Do not create npm/yarn/bun lockfiles, switch package managers, or add unnecessary dependencies.

## Career content

`PROFILE.md` is the human-readable reference for professional profile information.

Never invent, inflate, or silently change titles, employers, responsibilities, achievements, metrics, dates, technologies, education, or business impact. If information conflicts or is unclear, report it instead of guessing.

When profile data changes, check only the affected representations: portfolio UI, Vietnam/International CV, print views, downloadable PDFs, or SEO/structured metadata.

## CV print and PDFs

Canonical print routes:
- `/print/vietnam`
- `/print/international`

Files under `public/documents/` are reviewed production artifacts. Never overwrite them during build, lint, tests, CI, or unrelated automation. `pnpm build` must be read-only with respect to source assets.

Approved PDF workflow:
1. Update relevant content.
2. Review the corresponding print page.
3. Verify content, links, layout, margins, and page breaks.
4. Save/export the approved PDF.
5. Replace the corresponding file under `public/documents/` only with explicit user approval.
6. Verify the final PDF.

Experimental PDF generation must write to an ignored temporary directory.

## Frontend

Preserve the existing visual identity unless redesign is requested. For UI changes, keep existing components/tokens and verify only affected responsive/accessibility behavior when practical. Do not add visual or architectural complexity merely to appear sophisticated.

## Performance and SEO

Measure before non-trivial performance optimization. Preserve relevant titles/descriptions, canonical URLs, semantic headings, social metadata, structured data, `robots.txt`, and `sitemap.xml` when affected. Never invent professional claims for SEO or expose unnecessary personal information in structured data.

## Verification

Use the narrowest relevant check. Do not automatically run every command for a small localized edit.

Available checks:

```bash
pnpm lint
pnpm test
pnpm build
```

Use targeted browser verification for observable UI changes when practical. Expand to broader checks only for cross-cutting, risky, or release-related work. Never claim checks that were not run.

## Firebase and deployment

Use **Firebase Hosting Classic** from `dist/portfolio/browser`.

Do not introduce framework-aware Hosting, SSR, Cloud Functions, or Firebase App Hosting unless explicitly requested. Do not run `firebase init` when existing configuration is sufficient.

Manual production deployment:

```bash
pnpm build
firebase deploy --only hosting
```

Deployment requires explicit user approval.

CI may install dependencies, lint, test, build, and perform read-only verification. CI must not modify source files or approved CV PDFs. Keep credentials in the appropriate secret manager; never commit them.

## Shared skills

Default to **zero skills** for ordinary implementation. Do not inspect the skill catalog unless the request clearly needs a specialized workflow.

Relevant opt-in examples:
- `frontend-review` — explicit UI/UX/accessibility review
- `web-performance` — performance investigation
- `seo-audit` — SEO audit
- `career-content` — factual career/profile content work
- `cv-review` — CV review
- `cv-web-design` — CV/portfolio-specific design
- `pdf-quality` — PDF verification
- `code-review` — explicit code review
- `release-check` — explicit release-readiness check

Do not automatically chain planning, testing, review, performance, SEO, or release skills after implementation.

## Done

Stop when the requested outcome is implemented and proportionally verified. For small changes, a focused diff review plus the narrowest relevant check is enough. Do not create unrelated docs, abstractions, agents, skills, scripts, configuration, refactors, or cleanup.
