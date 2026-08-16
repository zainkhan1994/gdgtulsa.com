# Contributing to GDG Tulsa

Thanks for your interest in contributing. This is the official website for GDG Tulsa — a community site, not a commercial product. Keep that spirit in mind.

## Ground rules

- **No frameworks.** The site is intentionally plain HTML/CSS/JS with no build step. Keep it that way.
- **No hardcoded colors.** Use CSS tokens (`--blue`, `--ink`, `--muted`, etc.) defined in `:root` in `styles.css`.
- **No junk in the repo.** Don't commit PDFs, ZIPs, `.ai` files, browser exports, or anything that isn't a web asset. The `.gitignore` covers most of these.
- **Brand compliance.** Logos and brand assets must follow [Google's GDG brand guidelines](https://developers.google.com/community/gdg/resources/brand-guidelines). When in doubt, leave it out.

## Workflow

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/gdgtulsa.com.git
cd gdgtulsa.com

# 2. Create a branch
git checkout -b fix/description-of-fix

# 3. Make changes and test locally
python3 -m http.server 8000
# Open http://localhost:8000 and verify every page you touched

# 4. Commit
git commit -m "Short, present-tense description of what changed"

# 5. Push and open a PR
git push origin fix/description-of-fix
```

## What makes a good PR

- **Small scope.** One thing per PR. A typo fix and a layout change are two PRs.
- **Tested locally.** Check both desktop and mobile (browser DevTools → responsive mode).
- **No regressions.** Open every page you didn't touch and make sure they still work.
- **Clear description.** Explain what you changed and why in the PR body.

## What we don't accept

- New npm/yarn dependencies or build tooling
- Assets without clear licensing (especially Google-owned images)
- Unrelated cleanup bundled with feature changes
- Anything that requires a server to run (this is a static site)

## Questions?

Open an issue or reach out via [gdg.community.dev/gdg-tulsa](https://gdg.community.dev/gdg-tulsa/).
