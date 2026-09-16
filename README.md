# Nova Hoang — Portfolio & CV

Personal portfolio and interactive CV built with Angular. The project presents my professional background through dedicated Vietnam and International CV experiences, print-friendly CV pages, downloadable reviewed PDF versions, and an About page.

## Live Site

**Portfolio:** https://novahoangdev.web.app

## Features

- Vietnam and International CV presentations
- Dedicated A4 print views
- Reviewed downloadable PDF CVs
- Responsive portfolio interface
- Dark mode
- SEO and social metadata
- Firebase Hosting deployment
- pnpm-based development workflow

## Tech Stack

- Angular 22
- TypeScript
- SCSS
- pnpm
- Firebase Hosting
- Vitest

## Requirements

- Node.js version defined in `.nvmrc`
- pnpm version defined in `package.json`

## Getting Started

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd portfolio

nvm use
corepack enable
pnpm install
```

Start the local development server:

```bash
pnpm start
```

The application is available at:

```text
http://localhost:3000
```

## Available Commands

```bash
# Start the development server
pnpm start

# Run lint checks
pnpm lint

# Run tests
pnpm test

# Create a production build
pnpm build
```

`pnpm build` only builds the application. It must not modify approved source assets such as the production CV PDFs under `public/documents/`.

## Project Structure

```text
portfolio/
├── public/
│   └── documents/          # Reviewed production CV PDFs
├── scripts/                # Project utilities and verification scripts
├── src/                    # Angular application source
├── AGENTS.md               # Instructions for AI coding agents
├── PROFILE.md              # Human-readable profile reference
├── angular.json
├── firebase.json
├── package.json
├── pnpm-lock.yaml
└── README.md
```

Build output is generated under:

```text
dist/portfolio/browser/
```

The `dist/` and `node_modules/` directories are generated locally and are not committed.

## Profile Content

`PROFILE.md` provides a human-readable reference for professional profile information used throughout the project.

Application content is maintained in the Angular source. When profile or CV information changes, related website views, print views, and downloadable CV assets should be reviewed together to avoid inconsistencies.

## CV & Print Workflow

The portfolio provides dedicated print views:

```text
/print/vietnam
/print/international
```

The PDF files under `public/documents/` are reviewed production artifacts used by the website's CV download actions.

They are intentionally **not regenerated during `pnpm build`**.

When CV content changes:

1. Update the relevant profile/application content.
2. Open the corresponding print page.
3. Review layout, content, links, spacing, and page breaks.
4. Use the browser print dialog to save the approved version as PDF.
5. Replace the corresponding PDF under `public/documents/`.
6. Verify the final PDF before committing it.

Automated build, test, lint, and CI tasks must not overwrite files in `public/documents/`.

## Firebase Hosting

The project uses Firebase Hosting for static production deployment.

Firebase serves the Angular production output from:

```text
dist/portfolio/browser
```

`firebase.json` contains the Hosting configuration, including the SPA rewrite to `index.html`.

To deploy manually:

```bash
pnpm build
firebase deploy --only hosting
```

A local Firebase login is required for manual deployment.

## CI/CD

The intended deployment flow is:

```text
feature branch
      ↓
pull request
      ↓
CI checks
      ↓
manual review
      ↓
merge to main
      ↓
production build
      ↓
Firebase Hosting
```

Pull requests should pass the repository's lint, test, and build checks before being merged.

Production deployment is triggered from the `main` branch through GitHub Actions when the deployment workflow is configured.

Firebase credentials must be stored in GitHub Actions secrets and must never be committed to the repository.

## Package Management

This repository uses **pnpm**.

Use:

```bash
pnpm install
pnpm add <package>
pnpm remove <package>
```

Do not generate or commit lockfiles from other package managers:

```text
package-lock.json
yarn.lock
bun.lock
```

`pnpm-lock.yaml` is the canonical dependency lockfile and should be committed.

## AI-Assisted Development

This repository is designed to work with AI coding tools such as Codex, Claude, and GitHub Copilot.

Repository-specific agent instructions are documented in `AGENTS.md`.

AI tools should respect the existing architecture, package manager, security rules, and approval requirements. In particular, automated tooling must not overwrite approved CV PDFs or perform destructive operations without explicit approval.

## Contributing

This is primarily a personal portfolio, but the source is public for learning, reference, and technical discussion.

For changes:

1. Create a dedicated branch.
2. Keep commits focused and use Conventional Commits where practical.
3. Run the relevant checks locally.
4. Open a pull request.
5. Review the resulting website before merging.

## License

The source code is available under the [MIT License](LICENSE).

Personal CV/profile content, photographs, personal branding, and other personal assets are **not licensed for reuse** unless explicitly stated otherwise.
