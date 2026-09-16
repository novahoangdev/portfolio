# AGENTS.md

Repository-specific instructions for AI coding agents working on the Nova Hoang Portfolio.

These rules apply in addition to higher-level workspace instructions. Keep this file focused on repository invariants; use shared skills for task-specific workflows.

## Project

Public professional portfolio and CV website.

**Stack:** Angular 22, TypeScript, SCSS, pnpm, Vitest, Firebase Hosting  
**Production output:** `dist/portfolio/browser`

Primary goals:
- Present professional information clearly to recruiters and developers.
- Maintain accurate Vietnam and International CV experiences.
- Provide polished, responsive, accessible UI.
- Keep the site fast, SEO-friendly, and maintainable.
- Preserve reviewed downloadable CV PDFs.

## Working Principles

Priority when requirements conflict:

1. Correctness
2. Explicit user requirements
3. Safety and security
4. Data integrity
5. Maintainability
6. Accessibility and UX
7. Performance
8. Simplicity

Before meaningful edits:
- Inspect the relevant implementation and surrounding code.
- Follow existing architecture and conventions.
- Prefer the smallest coherent change.
- Avoid unrelated rewrites or formatting churn.
- Plan substantial features/refactors first when requested.

Do not claim a change works unless it was actually verified.

## Package Management

Use **pnpm only**.

`pnpm-lock.yaml` is the canonical lockfile and should be committed.

Do not create `package-lock.json`, `yarn.lock`, or `bun.lock`. Do not switch package managers or add unnecessary dependencies without explicit approval.

## Career and Profile Content

`PROFILE.md` is the human-readable reference for professional profile information.

Never invent, inflate, or silently change job titles, employers, responsibilities, achievements, metrics, dates, technologies, education, or business impact.

When profile information changes, check relevant representations for consistency:
- portfolio UI;
- Vietnam CV;
- International CV;
- print views;
- downloadable PDFs;
- SEO/structured metadata.

If information conflicts or is unclear, report it instead of guessing.

## CV Print Views

Canonical print routes:
- `/print/vietnam`
- `/print/international`

Print views should preserve A4 readability, stable page breaks, correct margins, readable typography, working links, and no clipped or accidental blank content.

Changes to shared profile data or styles may affect both website and print views. Verify both when relevant.

## Production CV PDFs

Files under `public/documents/` are **reviewed production artifacts**, not temporary build outputs.

Never overwrite them during build, lint, tests, CI, or unrelated automation. `pnpm build` must be read-only with respect to source assets.

Approved CV workflow:

1. Update relevant profile/application content.
2. Review the corresponding print page.
3. Verify content, links, layout, margins, and page breaks.
4. Save/export the approved version as PDF.
5. Replace the corresponding file under `public/documents/`.
6. Verify the final PDF before committing it.

Experimental PDF generation must write to an ignored temporary directory, never directly to `public/documents/`.

Replacing an approved production PDF requires explicit user approval.

## Frontend Quality

Preserve the existing visual identity unless a redesign is explicitly requested.

For meaningful UI changes, consider semantic HTML, responsive behavior, keyboard accessibility, visible focus states, sufficient contrast, reduced-motion preferences where relevant, consistent spacing/typography, predictable navigation, and recruiter-friendly information hierarchy.

Verify representative desktop and mobile layouts when UI behavior changes.

Do not add visual or architectural complexity merely to make the project appear more sophisticated.

## Performance and SEO

Measure before making non-trivial performance optimizations.

Pay attention to initial JavaScript, images/fonts, unnecessary dependencies, lazy loading, layout shift, third-party scripts, and Core Web Vitals.

Preserve relevant page titles/descriptions, canonical URLs, semantic headings, Open Graph/social metadata, structured data, `robots.txt`, and `sitemap.xml`.

Do not invent professional claims for SEO. Be cautious about exposing personal information in machine-readable structured data.

## Verification

Use checks relevant to the change:

```bash
pnpm lint
pnpm test
pnpm build
```

Also perform browser/user-flow verification when observable behavior changes.

Prefer verification over assumption. Reproduce bugs when practical, inspect UI/artifacts when relevant, and measure performance rather than guessing.

If a verification step cannot be performed, state that explicitly.

Do not modify production code merely to force a test to pass without understanding the failure.

## Firebase and Deployment

This project uses **Firebase Hosting Classic** for static deployment from `dist/portfolio/browser`.

Do not introduce framework-aware Hosting, SSR, Cloud Functions, or Firebase App Hosting unless explicitly requested.

Do not run `firebase init` merely because Firebase configuration already exists. Do not modify deployment configuration as a side effect of an unrelated task.

Manual production deployment:

```bash
pnpm build
firebase deploy --only hosting
```

Deployment requires explicit user approval.

## CI/CD

Expected flow:

`feature branch → pull request → CI → review → merge to main → production deployment`

CI may install dependencies, lint, test, build, and perform read-only verification. CI must not modify source files or approved CV PDFs.

Never commit Firebase service-account JSON, API keys, tokens, passwords, private keys, or other credentials. Store CI/CD credentials in the appropriate secret manager such as GitHub Actions secrets.

## Git and Remote Actions

Agents may perform normal local development actions such as reading/editing files and running lint, tests, builds, or Git inspection commands.

Explicit approval is required before:
- `git commit`;
- `git push`;
- merging;
- deploying;
- creating releases;
- modifying remote/shared state.

Permission to commit does not imply permission to push. Permission to push does not imply permission to deploy.

Use focused Conventional Commit messages when commits are approved. Do not rewrite published Git history unless explicitly requested.

## Dangerous Operations

Ask before actions that may delete user data or substantial project files, discard uncommitted work, overwrite approved artifacts, reset Git state, force push, change credentials, modify remote infrastructure, perform migrations, install system-level software, or execute untrusted remote scripts.

Never use destructive operations merely for convenience.

## Generated Files

Do not commit machine-local/generated artifacts unless intentionally part of the repository.

Normally excluded: `node_modules/`, `dist/`, `.angular/`, coverage output, `.DS_Store`, temporary files, local environment files, and experimental generated PDFs.

Approved PDFs under `public/documents/` are an intentional exception.

## Shared Skills

Use shared workspace skills only when they materially help the task.

Common skills:

- Engineering: `feature-planning`, `code-review`, `test-strategy`, `user-flow-testing`, `release-check`
- Frontend: `frontend-quality`, `ux-ui-review`, `web-performance`, `seo-audit`
- Career/CV: `career-content`, `cv-review`, `cv-web-design`, `pdf-quality`

Use the smallest relevant set rather than invoking every skill.

Typical flows:
- Feature: `feature-planning → implementation → test-strategy → user-flow-testing → code-review`
- UI: `frontend-quality → ux-ui-review → user-flow-testing`
- CV: `career-content → cv-review → pdf-quality`
- Release: `user-flow-testing → web-performance → seo-audit → release-check`

## Definition of Done

Before considering a task complete:

1. Review the diff.
2. Remove accidental/debug code and unused imports.
3. Avoid unrelated changes.
4. Confirm no secrets were introduced.
5. Run relevant verification.
6. Report what changed and what was actually verified.
7. Report remaining limitations.

Do not create extra documentation, abstractions, agents, skills, scripts, or configuration unless they provide ongoing value to this project.
