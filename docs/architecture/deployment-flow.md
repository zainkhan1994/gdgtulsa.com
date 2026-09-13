# Deployment Flow

A push to `main` triggers `.github/workflows/deploy.yml`. The workflow runs `scripts/build.sh`, uploads `build/` as the Pages artifact, and deploys it with the GitHub Pages deployment action.
