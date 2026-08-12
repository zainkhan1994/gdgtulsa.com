# GDG Tulsa Website

The official website for **Google Developer Group Tulsa** — a community of developers, students, and builders in Tulsa, Oklahoma. Live at [gdgtulsa.com](https://gdgtulsa.com), deployed via GitHub Pages.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home — hero, interactive globe, about, Programs, Events, Members, Get involved |
| `bwai.html` | Build with AI — what the program is, the official overview video, what to expect |
| `devfest.html` | DevFest Tulsa — the annual tentpole event |
| `about-gdg.html` | What Google Developer Groups are, and how Tulsa fits in |
| `organizer.html` | Organizer bio and verified credentials |
| `admin.html` | Firebase-backed member portal and admin dashboard |

All pages live at the repo root so their public URLs stay stable.

## Design system

The site runs on the **GDG signage system**, adapted from the `GDG24 Signage Letter`
templates in `assets/brand/`:

- Charcoal/black ground (`--bg` `#0f0f0f`, `--surface` `#1d1e1d`) across every page.
- A thin accent outline that steps around a glyph notch (top-right) and the GDG mark
  (bottom-right) — see `.signage-card` in `styles.css`.
- The four Google brand colors (`#4285f4`, `#fbbc04`, `#34a853`, `#ea4335`) rotate across
  card grids so no two adjacent cards share a color.

Neutrals are defined once as tokens in `:root`; prefer those over hardcoded hex values.

## Layout

```
├── index.html, bwai.html, devfest.html, …   page templates
├── styles.css                               all site styles
├── globe-explorer.css, globe.js             interactive globe
├── script.js                                nav, filtering, auth, member portal
├── firebase-config.js, firestore.rules      member portal backend
├── assets/
│   ├── brand/        signage templates + banner (brand source of truth)
│   ├── bwai/         Build with AI motion graphics
│   ├── badges/
│   │   ├── credentials/   verified certification badges (organizer.html)
│   │   └── roles/         speaker / member / partner badges (index.html)
│   └── logos/        product and Google marks
├── data/             GeoJSON for the globe
└── vendor/           pinned MapLibre GL build + license
```

Logos ending in `-dark` are the light-on-dark variants used against the dark ground.

## Tech Stack

- Static **HTML / CSS / JavaScript** — no build step
- **Firebase** (Auth + Firestore) for the member portal
- **GitHub Pages** hosting with a custom domain via `CNAME`

## Local development

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Contributing

Spot a typo or want to improve a page? Open an issue or PR. Keep changes consistent with
the signage system above and the official GDG brand guidelines.

## Community

- 🌐 [gdgtulsa.com](https://gdgtulsa.com)
- 👥 [Join us on GDG Community](https://gdg.community.dev/gdg-tulsa/)
- 📅 Find us at DevFest, Build with AI, and monthly meetups

GDG Tulsa is an independent community group, not an official Google product.
