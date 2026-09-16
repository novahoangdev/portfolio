# Nova Hoang — Portfolio and CV

Angular 22 portfolio with separate Vietnam and International CV presentations, an About page, dark mode, and two downloadable A4 PDF CVs.

## Requirements

- Node.js 22.22.3 or newer (`.nvmrc` is included)
- pnpm 12.4.1

## Development

```bash
nvm use
pnpm install
pnpm start
```

Open <http://localhost:3000> during local development.

## Checks

```bash
pnpm test
pnpm build
```

## Content

- `PROFILE.md` is the human-readable canonical profile record.
- `src/app/data/profile.ts` supplies content to the website and PDF layouts.
- `docs/project-plan.md` documents scope, design decisions, and release checks.
- Draft metrics marked `[N]` or `[X%]` must be replaced with verified figures before production publication.

## CV PDFs

The fixed A4 print layouts are available at:

- `/print/vietnam`
- `/print/international`

Generated documents are stored in `public/documents/` and linked from their matching CV tabs.

## Deployment

The live site is currently deployed with Firebase Hosting. `firebase.json` is intentionally kept because it defines the static build directory, SPA route rewrites, and cache headers used by the deployment. Local Firebase state and project selection (`.firebase/` and `.firebaserc`) are ignored.

```bash
pnpm build
firebase deploy --only hosting
```

Select the intended Firebase project before deploying; no project ID or deployment credentials are committed.


## License

The source code is available under the MIT License. Personal CV/profile content, photographs, personal branding, and other personal assets are not licensed for reuse unless explicitly stated.
