<div align="center">

<img src="src/frontend/assets/images/logos/gdg-community-logo-dark.png" alt="GDG Tulsa" width="180" />

# GDG Tulsa



A community of developers, designers, and builders in Tulsa, Oklahoma — powered by the Google Developer Groups program.

[![Live Site](https://img.shields.io/badge/Live%20Site-gdgtulsa.com-4285F4?style=flat-square&logo=google-chrome&logoColor=white)](https://gdgtulsa.com)
[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-222?style=flat-square&logo=github&logoColor=white)](https://github.com/zainkhan1994/gdgtulsa.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-34A853?style=flat-square)](LICENSE)

</div>

---

## Table of Contents

- [Pages](#pages)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Design System](#design-system)
- [Local Development](#local-development)
- [Contributing](#contributing)
- [Community](#community)

---

## Pages

| Page | URL | Description |
|------|-----|-------------|
| **Home** | `/` | Hero, interactive globe, programs, events, members |
| **Build with AI** | `/bwai.html` | Google's Build with AI program overview |
| **DevFest** | `/devfest.html` | Annual DevFest Tulsa event |
| **Google Ecosystem** | `/google-ecosystem.html` | Interactive Orbit/List/Grid/Table view of Google's developer platform |
| **Google Workspace** | `/google-workspace.html` | Workspace tools for organizations |
| **AI Stack** | `/ai-stack.html` | Google's full-stack AI ecosystem |
| **Hackathons** | `/hackathons.html` | Hackathon programs and resources |
| **About GDGs** | `/about-gdg.html` | What Google Developer Groups are |
| **Organizer** | `/organizer.html` | Organizer bio and verified credentials |
| **Members** | `/#members` | Firebase-backed member portal on the public site |

All pages live at the repo root so public URLs stay clean and stable.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla HTML, CSS, JavaScript — zero build step |
| **Hosting** | GitHub Pages with custom domain (`CNAME`) |
| **Backend** | Firebase Auth + Firestore for members; Cloud Run + BigQuery for the private admin system |
| **Maps** | MapLibre GL (pinned, vendored) |
| **Fonts/Icons** | Google Fonts via CDN |

No framework. No bundler. No dependencies to install. Pages load fast and deploy instantly on push.

---

## Project Structure

```
gdgtulsa.com/
├── src/frontend/               # Pages, browser code, CSS, images, data, vendor files
├── src/backend/services/       # Independently deployable Python services
├── tests/backend/              # Backend tests organized by service
├── infra/terraform/            # Terraform infrastructure definitions
├── infra/policies/             # Policy-as-code and security rules
├── scripts/                    # Build, test, lint, bootstrap, and deployment helpers
├── docs/                       # Architecture, ADRs, onboarding, and runbooks
├── .github/workflows/          # CI and GitHub Pages deployment
├── config/                     # Non-secret environment-specific configuration
├── build/                      # Generated GitHub Pages artifact, ignored by Git
├── CNAME                       # Custom domain source for the Pages artifact
└── .nojekyll                   # Copied into the Pages artifact
```

The public site remains URL-compatible with its existing root routes. Run
`./scripts/build.sh` to package the organized source into the deployable
`build/` directory.

---

## Design System

The site uses the **GDG signage system** — a dark-ground design adapted from the official GDG24 Signage templates.

**Tokens (defined in `:root`):**

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#0f0f0f` | Page background |
| `--surface` | `#1d1e1d` | Card / panel background |
| `--soft` | `#2a2b2a` | Hover states, subtle fills |
| `--line` | `#333` | Borders and dividers |
| `--ink` | `#f5f5f5` | Primary text |
| `--muted` | `#888` | Secondary text |
| `--blue` | `#4285F4` | Google Blue |
| `--red` | `#EA4335` | Google Red |
| `--yellow` | `#FBBC04` | Google Yellow |
| `--green` | `#34A853` | Google Green |

The four Google brand colors rotate across card grids so no two adjacent cards share a color.

**Key components:** `.signage-card`, `.stat-row`, `.pill-label`, `.gradient-card`, `.product-chip`, `.orbit-*`

---

## Local Development

No install step required.

```bash
# Clone
git clone https://github.com/zainkhan1994/gdgtulsa.com.git
cd gdgtulsa.com

# Build and serve locally
./scripts/build.sh
python3 -m http.server 8000 --directory build
```

Open [http://localhost:8000](http://localhost:8000).

> **Note:** The member portal is part of the public homepage and requires Firebase. The admin dashboard runs separately as a private Cloud Run application and is not part of the public GitHub Pages site.

---

## Contributing

Contributions are welcome. Please keep changes consistent with the GDG brand guidelines and the signage design system above.

1. Fork the repo and create a branch: `git checkout -b fix/your-fix-name`
2. Make your changes
3. Test locally with `python3 -m http.server 8000`
4. Open a pull request with a clear description of what changed and why

**What to keep in mind:**
- No build step — plain HTML/CSS/JS only
- Use CSS tokens (`--blue`, `--ink`, etc.) — no hardcoded hex values
- Keep the dark-ground aesthetic consistent across pages
- Logos and brand assets must comply with [Google's brand guidelines](https://developers.google.com/community/gdg/resources/brand-guidelines)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

---

## Community

| | |
|--|--|
| 🌐 Website | [gdgtulsa.com](https://gdgtulsa.com) |
| 👥 GDG Community | [gdg.community.dev/gdg-tulsa](https://gdg.community.dev/gdg-tulsa/) |


---

<div align="center">

GDG Tulsa is an independent community group organized under the Google Developer Groups program.<br>
It is not an official Google product.

</div>
